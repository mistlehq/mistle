use std::io::{self, Write};

use mstl_core::auth::API_KEY_ENV_VAR;
use mstl_core::client::{
    CurrentUserOrganization, CurrentUserOrganizationsResponse, MistleClient,
    MistleClientAuthorizationHeaderConfig, SwitchOrganizationRequest,
};

use crate::auth_file::{self, OAuthAuth};
use crate::config::{mistle_client, optional_env_var};
use crate::error::CliError;
use crate::format::format_bool;
use crate::login::{current_unix_seconds, oauth_token_response_to_auth, refresh_oauth_auth};

const OAUTH_REFRESH_GRACE_SECONDS: u64 = 60;

pub(crate) fn run_list<W, E>(stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match list_organizations() {
        Ok(organizations) => match write_organizations(stdout, &organizations) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write organizations: {error}");
                1
            }
        },
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

pub(crate) fn run_switch<W, E>(selector: &str, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match switch_organization(selector) {
        Ok(result) => match write_switched_organization(stdout, &result) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write switched organization: {error}");
                1
            }
        },
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

fn list_organizations() -> Result<CurrentUserOrganizationsResponse, CliError> {
    mistle_client()?
        .list_current_user_organizations()
        .map_err(|source| CliError::Client {
            action: "list organizations",
            source,
        })
}

fn switch_organization(selector: &str) -> Result<SwitchOrganizationResult, CliError> {
    reject_api_key_env_auth()?;
    let base_url = crate::config::control_plane_api_public_url()?;
    let oauth = fresh_oauth_auth(&base_url, read_oauth_auth()?)?;
    let client = oauth_client(&base_url, &oauth.access_token)?;
    let organizations =
        client
            .list_current_user_organizations()
            .map_err(|source| CliError::Client {
                action: "list organizations",
                source,
            })?;
    let organization = resolve_organization(selector, &organizations)?;
    let token = client
        .switch_organization(SwitchOrganizationRequest {
            organization_id: &organization.id,
        })
        .map_err(|source| CliError::Client {
            action: "switch organization",
            source,
        })?;

    auth_file::write_oauth(oauth_token_response_to_auth(token)?)?;

    Ok(SwitchOrganizationResult { organization })
}

fn write_organizations<W>(
    stdout: &mut W,
    response: &CurrentUserOrganizationsResponse,
) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_organizations(response))
}

fn write_switched_organization<W>(
    stdout: &mut W,
    result: &SwitchOrganizationResult,
) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_switched_organization(result))
}

fn render_organizations(response: &CurrentUserOrganizationsResponse) -> String {
    if response.organizations.is_empty() {
        return "No organizations found.\n".to_owned();
    }

    let rows: Vec<OrganizationRow> = response
        .organizations
        .iter()
        .map(OrganizationRow::from_organization)
        .collect();
    let widths = OrganizationTableWidths::from_rows(&rows);
    let mut output = String::new();

    output.push_str(&format!(
        "{:<current_width$}  {:<name_width$}  {:<slug_width$}  {:<role_width$}  {}\n",
        "CURRENT",
        "NAME",
        "SLUG",
        "ROLE",
        "ID",
        current_width = widths.current,
        name_width = widths.name,
        slug_width = widths.slug,
        role_width = widths.role,
    ));

    for row in rows {
        output.push_str(&format!(
            "{:<current_width$}  {:<name_width$}  {:<slug_width$}  {:<role_width$}  {}\n",
            row.current,
            row.name,
            row.slug,
            row.role,
            row.id,
            current_width = widths.current,
            name_width = widths.name,
            slug_width = widths.slug,
            role_width = widths.role,
        ));
    }

    output
}

fn render_switched_organization(result: &SwitchOrganizationResult) -> String {
    format!(
        "Switched organization\nName: {}\nSlug: {}\nID: {}\n",
        result.organization.name, result.organization.slug, result.organization.id,
    )
}

fn reject_api_key_env_auth() -> Result<(), CliError> {
    match optional_env_var(API_KEY_ENV_VAR)? {
        Some(_) => Err(CliError::OAuthLoginRequired),
        None => Ok(()),
    }
}

fn read_oauth_auth() -> Result<OAuthAuth, CliError> {
    match auth_file::read_auth_credential() {
        Ok(auth_file::AuthCredential::OAuth(oauth)) => Ok(oauth),
        Ok(auth_file::AuthCredential::ApiKey(_)) | Err(CliError::MissingAuthFile) => {
            Err(CliError::OAuthLoginRequired)
        }
        Err(error) => Err(error),
    }
}

fn fresh_oauth_auth(base_url: &str, oauth: OAuthAuth) -> Result<OAuthAuth, CliError> {
    let current_time = current_unix_seconds()?;
    if oauth.expires_at_unix_seconds > current_time + OAUTH_REFRESH_GRACE_SECONDS {
        return Ok(oauth);
    }

    let refreshed_oauth = refresh_oauth_auth(base_url, &oauth.refresh_token)?;
    auth_file::write_oauth(refreshed_oauth.clone())?;
    Ok(refreshed_oauth)
}

fn oauth_client(base_url: &str, access_token: &str) -> Result<MistleClient, CliError> {
    MistleClient::new_with_authorization_header(MistleClientAuthorizationHeaderConfig {
        base_url: base_url.to_owned(),
        authorization_header: format!("Bearer {access_token}"),
    })
    .map_err(|source| CliError::Client {
        action: "configure Mistle client",
        source,
    })
}

fn resolve_organization(
    selector: &str,
    response: &CurrentUserOrganizationsResponse,
) -> Result<CurrentUserOrganization, CliError> {
    let selector = selector.trim();
    let matches: Vec<&CurrentUserOrganization> = response
        .organizations
        .iter()
        .filter(|organization| organization.id == selector || organization.slug == selector)
        .collect();

    match matches.as_slice() {
        [organization] => Ok((**organization).clone()),
        [] => Err(CliError::OrganizationSelectorNotFound {
            selector: selector.to_owned(),
        }),
        _ => Err(CliError::OrganizationSelectorAmbiguous {
            selector: selector.to_owned(),
        }),
    }
}

struct SwitchOrganizationResult {
    organization: CurrentUserOrganization,
}

struct OrganizationRow {
    current: &'static str,
    name: String,
    slug: String,
    role: String,
    id: String,
}

impl OrganizationRow {
    fn from_organization(organization: &CurrentUserOrganization) -> Self {
        Self {
            current: format_bool(organization.is_current),
            name: organization.name.clone(),
            slug: organization.slug.clone(),
            role: organization.role.clone(),
            id: organization.id.clone(),
        }
    }
}

struct OrganizationTableWidths {
    current: usize,
    name: usize,
    slug: usize,
    role: usize,
}

impl OrganizationTableWidths {
    fn from_rows(rows: &[OrganizationRow]) -> Self {
        let mut widths = Self {
            current: "CURRENT".len(),
            name: "NAME".len(),
            slug: "SLUG".len(),
            role: "ROLE".len(),
        };

        for row in rows {
            widths.current = widths.current.max(row.current.len());
            widths.name = widths.name.max(row.name.len());
            widths.slug = widths.slug.max(row.slug.len());
            widths.role = widths.role.max(row.role.len());
        }

        widths
    }
}

#[cfg(test)]
mod tests {
    use mstl_core::client::{CurrentUserOrganization, CurrentUserOrganizationsResponse};

    use crate::org::{
        SwitchOrganizationResult, render_organizations, render_switched_organization,
        resolve_organization,
    };

    #[test]
    fn renders_empty_organization_list() {
        let response = CurrentUserOrganizationsResponse {
            organizations: Vec::new(),
        };

        assert_eq!(render_organizations(&response), "No organizations found.\n");
    }

    #[test]
    fn renders_organization_list_table() {
        let response = CurrentUserOrganizationsResponse {
            organizations: vec![
                CurrentUserOrganization {
                    id: "org_first".to_owned(),
                    name: "First Organization".to_owned(),
                    slug: "first".to_owned(),
                    role: "owner".to_owned(),
                    is_current: true,
                },
                CurrentUserOrganization {
                    id: "org_second".to_owned(),
                    name: "Second".to_owned(),
                    slug: "second-org".to_owned(),
                    role: "member".to_owned(),
                    is_current: false,
                },
            ],
        };

        assert_eq!(
            render_organizations(&response),
            concat!(
                "CURRENT  NAME                SLUG        ROLE    ID\n",
                "yes      First Organization  first       owner   org_first\n",
                "no       Second              second-org  member  org_second\n",
            ),
        );
    }

    #[test]
    fn resolves_organization_by_id() {
        let response = organization_response();

        let organization =
            resolve_organization("org_second", &response).expect("organization should resolve");

        assert_eq!(organization.slug, "second-org");
    }

    #[test]
    fn resolves_organization_by_slug() {
        let response = organization_response();

        let organization =
            resolve_organization("first", &response).expect("organization should resolve");

        assert_eq!(organization.id, "org_first");
    }

    #[test]
    fn rejects_unknown_organization_selector() {
        let response = organization_response();

        let error = resolve_organization("missing", &response)
            .expect_err("unknown organization should fail");

        assert_eq!(error.to_string(), "organization `missing` was not found");
    }

    #[test]
    fn rejects_ambiguous_organization_selector() {
        let response = CurrentUserOrganizationsResponse {
            organizations: vec![
                CurrentUserOrganization {
                    id: "org_first".to_owned(),
                    name: "First Organization".to_owned(),
                    slug: "shared".to_owned(),
                    role: "owner".to_owned(),
                    is_current: true,
                },
                CurrentUserOrganization {
                    id: "shared".to_owned(),
                    name: "Shared ID Organization".to_owned(),
                    slug: "second".to_owned(),
                    role: "member".to_owned(),
                    is_current: false,
                },
            ],
        };

        let error = resolve_organization("shared", &response)
            .expect_err("ambiguous organization should fail");

        assert_eq!(
            error.to_string(),
            "organization `shared` matched multiple organizations"
        );
    }

    #[test]
    fn renders_switched_organization_summary() {
        let result = SwitchOrganizationResult {
            organization: CurrentUserOrganization {
                id: "org_second".to_owned(),
                name: "Second Organization".to_owned(),
                slug: "second-org".to_owned(),
                role: "member".to_owned(),
                is_current: false,
            },
        };

        assert_eq!(
            render_switched_organization(&result),
            concat!(
                "Switched organization\n",
                "Name: Second Organization\n",
                "Slug: second-org\n",
                "ID: org_second\n",
            ),
        );
    }

    fn organization_response() -> CurrentUserOrganizationsResponse {
        CurrentUserOrganizationsResponse {
            organizations: vec![
                CurrentUserOrganization {
                    id: "org_first".to_owned(),
                    name: "First Organization".to_owned(),
                    slug: "first".to_owned(),
                    role: "owner".to_owned(),
                    is_current: true,
                },
                CurrentUserOrganization {
                    id: "org_second".to_owned(),
                    name: "Second".to_owned(),
                    slug: "second-org".to_owned(),
                    role: "member".to_owned(),
                    is_current: false,
                },
            ],
        }
    }
}

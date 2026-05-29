use std::io::{self, Write};

use mstl_core::client::{CurrentUserOrganization, CurrentUserOrganizationsResponse};

use crate::config::mistle_client;
use crate::error::CliError;
use crate::format::format_bool;

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

fn list_organizations() -> Result<CurrentUserOrganizationsResponse, CliError> {
    mistle_client()?
        .list_current_user_organizations()
        .map_err(|source| CliError::Client {
            action: "list organizations",
            source,
        })
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

    use crate::org::render_organizations;

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
}

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressGrantRefreshInput {
    pub runtime_plan: serde_json::Value,
    pub egress_grant_by_rule_id: BTreeMap<String, String>,
}

UPDATE "data_plane"."sandbox_instance_runtime_plans"
SET "compiled_runtime_plan" = jsonb_set(
  "compiled_runtime_plan",
  '{associatedResourceEventRouting}',
  '{"enabled": false, "resources": []}'::jsonb,
  true
)
WHERE NOT "compiled_runtime_plan" ? 'associatedResourceEventRouting';

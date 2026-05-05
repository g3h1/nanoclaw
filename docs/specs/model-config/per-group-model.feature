Feature: Per-agent-group model selection
  As an operator
  I want each agent group to use a specific Claude model
  So that I can match model capability to workload per group

  Background:
    Given an agent group exists

  Scenario: Setting a model on an existing group
    When the operator sets the group's model to "claude-opus-4-7"
    And the group's container restarts
    Then subsequent agent turns in that group use "claude-opus-4-7"

  Scenario: Newly created group has no model configured
    When a new agent group is created without specifying a model
    Then the group's model field is empty
    And the group resolves its active model from the global default

  Scenario: Clearing a group's model falls back to the default
    Given the group's model is "claude-haiku-4-5-20251001"
    When the operator clears the group's model
    And the group's container restarts
    Then the group resolves its active model from the global default

  Scenario: Setting an invalid or unsupported model id
    When the operator attempts to set the group's model to a value the active provider does not accept
    Then the change is rejected with a clear error
    And the previous model remains in effect

  Scenario: Changing the model takes effect on the next session, not mid-turn
    Given the group's container is running and processing a turn
    When the operator changes the group's model
    Then the in-flight turn completes on the previous model
    And the next session in the group uses the new model

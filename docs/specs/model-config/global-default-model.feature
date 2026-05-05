Feature: Global default model
  As an operator
  I want a single place to set the default model for every agent group
  So that I can roll out a new model without editing each group

  Scenario: Operator configures a global default
    Given no group-level model is set
    When the operator sets the global default model to "claude-sonnet-4-6"
    And a group's container starts
    Then agent turns in that group use "claude-sonnet-4-6"

  Scenario: Group-level model overrides the global default
    Given the global default is "claude-sonnet-4-6"
    And a group's model is "claude-opus-4-7"
    When the group's container starts
    Then agent turns in that group use "claude-opus-4-7"

  Scenario: No global default and no group-level model
    Given the global default is unset
    And the group's model is unset
    When the group's container starts
    Then the group falls back to the SDK's built-in default model

  Scenario: Changing the global default does not retroactively change group-level models
    Given two groups exist: group A has model "claude-opus-4-7" and group B has no model
    When the operator changes the global default from "claude-sonnet-4-6" to a different model
    Then group A's active model remains "claude-opus-4-7"
    And group B's active model becomes the new global default

  Scenario: Operator can read back the current global default
    When the operator queries the global default model
    Then the response returns the configured value, or indicates that no default is set

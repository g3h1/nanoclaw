Feature: Subagent model override
  As an admin user
  I want to spin up a subagent with a different model than its parent
  So that cheaper or faster work runs on a smaller model without changing the parent

  Scenario: Admin creates a subagent with an explicit model
    Given an admin is talking to a parent agent group running "claude-opus-4-7"
    When the admin creates a subagent named "Researcher" with model "claude-haiku-4-5-20251001"
    Then a new agent group is created with model "claude-haiku-4-5-20251001"
    And the parent group's model is unchanged
    And the subagent's first turn uses "claude-haiku-4-5-20251001"

  Scenario: Admin creates a subagent without specifying a model
    Given an admin is talking to a parent agent group running "claude-opus-4-7"
    When the admin creates a subagent without specifying a model
    Then the new agent group inherits the parent's model "claude-opus-4-7"

  Scenario: Non-admin attempts to create a subagent with a custom model
    Given a non-admin user is talking to an agent group
    When the non-admin attempts to create a subagent with any model override
    Then the request is rejected
    And no new agent group is created

  Scenario: Subagent created with a model unsupported by the parent's provider
    Given an admin is talking to a parent agent group with provider "claude"
    When the admin attempts to create a subagent with a model the provider cannot serve
    Then the request is rejected with a clear error
    And no new agent group is created

  Scenario: Subagent's model is editable after creation
    Given a subagent group exists with model "claude-haiku-4-5-20251001"
    When an admin changes the subagent group's model
    Then the change follows the same rules as any other per-group model change

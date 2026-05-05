Feature: Model selection precedence
  As an operator
  I want a single, predictable rule for which model wins
  So that I can debug "why is this group using model X" without guessing

  Rule: The first source that supplies a value wins, in this order:
        group-level model > global default > SDK built-in default

    Scenario: Group-level beats everything
      Given the group's model is "claude-opus-4-7"
      And the global default is "claude-sonnet-4-6"
      Then the group's active model is "claude-opus-4-7"
      And the precedence source is "group"

    Scenario: Global default applies when group has no model
      Given the group's model is unset
      And the global default is "claude-sonnet-4-6"
      Then the group's active model is "claude-sonnet-4-6"
      And the precedence source is "global default"

    Scenario: SDK default applies when nothing else is set
      Given the group's model is unset
      And the global default is unset
      Then the group's active model is whatever the SDK chooses
      And the precedence source is "sdk default"

  Scenario: Operator can inspect the effective model and its source
    Given an agent group is running
    When the operator queries the group's effective model
    Then the response includes the active model id
    And the response includes which source supplied it

  Scenario: Switching providers does not silently change the model source
    Given the group's model is "claude-opus-4-7" and source is "group"
    When the operator changes the group's provider to one that cannot serve "claude-opus-4-7"
    Then the provider change is rejected, OR the operator is required to set a compatible group-level model as part of the same change
    And the group never silently falls back to a different model than the operator chose

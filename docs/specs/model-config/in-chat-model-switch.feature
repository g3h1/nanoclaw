Feature: Switching the active model from chat
  As an admin user
  I want to ask the agent to change its own model in conversation
  So that I can adapt to the current task without leaving chat

  Scenario: Admin asks the agent to switch to a more capable model
    Given an admin is in a group whose active model is "claude-sonnet-4-6"
    When the admin asks the agent to switch its model to "claude-opus-4-7"
    Then a model-change approval is requested from an admin
    And on approval, the group's model becomes "claude-opus-4-7"
    And the group's container restarts to pick up the new model
    And subsequent turns use "claude-opus-4-7"

  Scenario: Approval is denied
    Given a pending model-change approval exists
    When the approver denies the request
    Then the group's model is unchanged
    And the container is not restarted
    And the requester is informed that the change was rejected

  Scenario: Non-admin requests a model change
    Given a non-admin member of the group asks the agent to switch models
    When the agent receives the request
    Then the agent declines and explains that only admins can change the model
    And no approval is requested

  Scenario: Admin requests a model that the active provider does not support
    Given an admin asks for an unsupported model id
    When the agent attempts to validate the requested model
    Then the request is rejected before any approval is created
    And the agent reports the rejection with a clear reason

  Scenario: Admin asks to revert to the previous model
    Given the group's previous model was "claude-sonnet-4-6"
    And the active model is "claude-opus-4-7"
    When an admin asks the agent to revert
    Then the same approval flow is triggered with target "claude-sonnet-4-6"

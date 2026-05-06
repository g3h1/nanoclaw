Feature: Outcome tracking and rule distillation
  As the operator
  I want my agent to log corrections in the moment and periodically distil them into rules
  So that improvement happens incrementally without retroactive transcript analysis

  Background:
    Given a subject agent that maintains an outcomes log in its workspace
    And each outcome record captures the original approach, the correction, and a topic tag

  Scenario: Recording a correction during a conversation
    Given the operator corrects the agent's approach mid-conversation
    When the agent classifies the correction as durable rather than situational
    Then it appends an outcome record with the original approach, the correction, and a topic tag
    And it acknowledges the correction in the conversation without a further confirmation prompt

  Scenario: Distinguishing durable corrections from situational context
    Given a message that adjusts the agent's approach only for the current task
    When the agent classifies the adjustment as situational
    Then no outcome record is written
    And the adjustment applies only to the active session

  Scenario: Periodic distillation into candidate rules
    Given the outcomes log contains entries since the last distillation
    When a distillation pass runs
    Then entries that recur on the same topic are grouped into a candidate rule
    And isolated entries remain in the log without being promoted
    And each candidate rule includes the topic, the rule statement, and the supporting outcome ids

  Scenario: Surfacing candidate rules for approval
    Given a candidate rule produced by the distillation pass
    When the operator is reachable
    Then the rule is delivered with its supporting outcomes
    And the operator can approve, reject, or edit the rule before it becomes durable

  Scenario: Avoiding duplicate or contradictory rules
    Given an existing rule on a topic
    When a candidate rule on the same topic would restate or contradict it
    Then the existing rule is referenced instead of producing a duplicate proposal
    And contradictions are surfaced to the operator for resolution

  Scenario: Settling rules that stop generating evidence
    Given a durable rule that has been in effect for a configured period
    When no recent outcomes support or contradict it
    Then the rule is marked as settled and excluded from further review
    And the operator receives a periodic summary of newly settled rules

  Scenario: Misclassified correction is corrected later
    Given an outcome record was written during a conversation
    When the operator later indicates the correction was situational, not durable
    Then the outcome record is annotated as situational
    And it is excluded from future distillation passes

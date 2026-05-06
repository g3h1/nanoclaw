Feature: Model configuration is discoverable across the instruction surface
  As an operator and as the agent itself
  I want guidance about model configuration to be reachable from where I work
  So that the feature is usable without reading source code

  # The agent's own runtime instructions (container side)

  Scenario: The agent has guidance for choosing a subagent's model
    Given the agent is preparing to create a subagent
    When the agent consults its base instructions
    Then it finds policy text describing when to prefer a smaller model and when to prefer a larger one
    And the policy names sensible defaults for narrow lookup tasks, code or design tasks, and ambiguous reasoning tasks

  Scenario: The create_agent tool advertises model selection at the point of use
    Given the agent enumerates its available tools
    When it reads the create_agent tool description
    Then the description exposes an optional model parameter
    And the description includes selection hints the agent can act on without further coaching

  Scenario: A model-change tool, when present, states its approval requirement up front
    Given a self-modification tool for changing the active model exists
    When the agent reads that tool's description
    Then the description states clearly that the change requires admin approval
    And the description explains that the container will restart on approval

  # The operator's skills (host side)

  Scenario: /customize offers model configuration as a first-class option
    Given an operator runs /customize
    When the skill presents available changes
    Then setting or clearing the active group's model is one of the offered options
    And setting the global default model is one of the offered options

  Scenario: First-run flows let the operator pick a default model
    Given an operator runs /setup or /init-first-agent for the first time
    When the skill walks them through configuration
    Then they may choose a global default model
    Or they may skip and accept the SDK default with a clear note about what that means

  Scenario: /debug surfaces the effective model and its source
    Given an agent group is running
    When an operator runs /debug for that group
    Then the output includes the active model id
    And the output includes which source supplied it (group, global default, or SDK default)

  # Provider-specific install skills

  Scenario: Provider-install skills reconcile with the unified model field
    Given an operator runs a provider-install skill such as /add-opencode or /add-codex
    When the skill completes
    Then either the unified group-level model field still controls model selection for that provider
    Or the skill explains in plain language how the provider's own model config takes precedence and what to set where

  # Project documentation

  Scenario: Project docs describe the model field
    Given a contributor reads the project's central-DB and architecture docs
    When they look up agent_groups
    Then a model field is documented along with its purpose, its default behavior when unset, and how it interacts with the global default and the SDK default

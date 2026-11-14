Feature: Approving agent proposals
  The agent may propose a write, but nothing changes until a signed-in user approves it.

  Scenario: a proposed write waits for approval
    Given the orders-5xx-spike signal is breaching
    When the monitor runs
    Then a write proposal for "reprocess-dlq" is pending
    And nothing has run

  Scenario: approval runs the write once and records who approved
    Given the orders-5xx-spike signal is breaching
    And the monitor has run and proposed a write
    When "hector" approves the proposal
    Then the write "reprocess-dlq" has run once
    And the approval status is "executed"
    And the audit log records "approval.approved" by "hector"

  Scenario: a second approval does not run the write again
    Given the orders-5xx-spike signal is breaching
    And the monitor has run and proposed a write
    And "hector" has approved the proposal
    When "hector" approves the proposal
    Then the attempt is refused as "invalid-state"
    And the write "reprocess-dlq" has run once

  Scenario: rejection means the write never runs
    Given the orders-5xx-spike signal is breaching
    And the monitor has run and proposed a write
    When "hector" rejects the proposal
    Then the approval status is "rejected"
    And nothing has run

  Scenario: a proposal expires after 24 hours and cannot be approved
    Given the orders-5xx-spike signal is breaching
    And the monitor has run and proposed a write
    When the request is past its 24-hour window
    And "hector" approves the proposal
    Then the attempt is refused as "expired"
    And nothing has run

  Scenario: an approval interrupted by a restart is failed, not retried
    Given the orders-5xx-spike signal is breaching
    And the monitor has run and proposed a write
    And the approval was interrupted mid-run
    When the service restarts
    Then the approval status is "failed"
    And nothing has run

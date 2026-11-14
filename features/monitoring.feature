Feature: Monitoring integrations
  A monitor only wakes the agent when its signal says something is wrong.

  Scenario: a healthy signal leaves the agent asleep
    Given the signal reads healthy
    When the monitor runs
    Then no finding is opened
    And the agent is not called

  Scenario: a breach opens a finding with the agent's assessment
    Given the orders-5xx-spike signal is breaching
    When the monitor runs
    Then a finding is opened
    And the agent is called

  Scenario: an unreadable signal is reported as a finding, not a crash
    Given the signal cannot be read
    When the monitor runs
    Then the finding is an unavailable signal

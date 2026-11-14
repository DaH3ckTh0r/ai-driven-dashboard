Feature: Signing in with a Microsoft account
  The app checks for an existing session first and asks for sign-in only when there is none.

  Scenario: a returning user with a live session is not asked to sign in
    Given "hector@contoso.com" signed in 20 minutes ago
    When the app checks for a session
    Then the signed-in user is "hector@contoso.com"

  Scenario: a session unused for 30 minutes ends and sign-in is asked for again
    Given "hector@contoso.com" signed in 31 minutes ago
    When the app checks for a session
    Then nobody is signed in

  Scenario: a visitor without a session is sent to Microsoft sign-in
    When the app checks for a session
    Then nobody is signed in
    When the visitor starts sign-in
    Then the visitor is sent to the Microsoft sign-in page

  Scenario: completing sign-in starts a session
    When the visitor starts sign-in
    And Microsoft confirms the sign-in of "hector@contoso.com"
    And the app checks for a session
    Then the signed-in user is "hector@contoso.com"

  Scenario: a session ends after 12 hours and sign-in is asked for again
    Given "hector@contoso.com" signed in 13 hours ago
    When the app checks for a session
    Then nobody is signed in

  Scenario: a sign-in response for a state that was never issued is refused
    When Microsoft returns a sign-in response with state "forged"
    Then the sign-in is refused

# BUG-706 — The login response carries a field we never meant to send

- **Reported by:** Esther (Security Engineering)
- **Severity:** S1 — stored credential material leaves the server
- **Affects:** authentication

## What happened

I was going through what the web app keeps in browser storage, expecting to
argue about the session token. The token is fine. What is sitting next to it is a
field off our users table that nobody asked for, and its contents are the stored
form of that account's password.

It is in the sign-in response itself, so it is not the web app's doing — every
client we have, and every proxy and log between us and them, has been handed it.
I have not checked how long for.

To be clear about the blast radius: this is the stored form, not the password
itself, and that is the only reason this is a ticket and not a phone call. It
still must not leave the server, and it certainly must not be cached in fifty
thousand browsers.

## Steps to reproduce

1. Sign in through the API.
2. Look at the user object in the response.

Expected: the id, email, role and display name. That is what the contract
describes and all any client needs.
Actual: those four and the account's stored credential.

## Notes

Worth checking the other endpoints that return a person — I only looked at
sign-in because that is where browser storage gets filled.

## Definition of done

- No response carries credential material, from any endpoint.
- The user object in the sign-in response carries exactly the fields the contract
  describes, and sign-in still works.
- A regression test covers it.

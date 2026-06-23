package com.ticketforge.security;

/** The authenticated principal. */
public record AuthUser(String id, String email, String role, String name) {

  public boolean isAdmin() {
    return "admin".equals(role);
  }

  public boolean isOrganizer() {
    return "organizer".equals(role);
  }
}

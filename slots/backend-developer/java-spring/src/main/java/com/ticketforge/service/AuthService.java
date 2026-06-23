package com.ticketforge.service;

import com.ticketforge.api.Dtos;
import com.ticketforge.error.AppException;
import com.ticketforge.error.ErrorCode;
import com.ticketforge.security.AuthUser;
import com.ticketforge.security.JwtService;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/** Login and bearer-token authentication. */
@Service
public class AuthService {

  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwt;

  public AuthService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, JwtService jwt) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.jwt = jwt;
  }

  public Dtos.LoginResponse login(String email, String password) {
    // One place to change when the user record grows a field.
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, email, role::text AS role, name, password_hash FROM users WHERE email = ?",
            email);

    Map<String, Object> row = rows.isEmpty() ? null : rows.get(0);
    // Same message for unknown email and bad password — no user enumeration.
    if (row == null || !passwordEncoder.matches(password, (String) row.get("password_hash"))) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, "Invalid email or password");
    }

    String token = jwt.sign((String) row.get("id"), (String) row.get("role"));
    return new Dtos.LoginResponse(token, row);
  }

  /** Re-reads the user on every request so revoked/changed roles take effect immediately. */
  public AuthUser loadUser(String id) {
    List<AuthUser> rows =
        jdbc.query(
            "SELECT id, email, role::text AS role, name FROM users WHERE id = ?",
            (rs, i) ->
                new AuthUser(
                    rs.getString("id"),
                    rs.getString("email"),
                    rs.getString("role"),
                    rs.getString("name")),
            id);
    if (rows.isEmpty()) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, "User not found");
    }
    return rows.get(0);
  }
}

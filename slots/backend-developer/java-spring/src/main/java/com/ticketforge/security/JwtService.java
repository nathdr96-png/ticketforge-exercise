package com.ticketforge.security;

import com.ticketforge.config.AppProperties;
import com.ticketforge.error.AppException;
import com.ticketforge.error.ErrorCode;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

/** HS256 bearer tokens: {@code {sub: userId, role}} with a 12h expiry. */
@Service
public class JwtService {

  private final AppProperties props;
  private final SecretKey key;

  public JwtService(AppProperties props) {
    this.props = props;
    this.key = deriveKey(props.getJwtSecret());
  }

  /**
   * HS256 requires a >=256-bit key; the contract's dev secret is shorter, so the raw secret
   * is stretched with SHA-256. Deterministic, so tokens stay valid across restarts.
   */
  private static SecretKey deriveKey(String secret) {
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8));
      return new SecretKeySpec(digest, "HmacSHA256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 unavailable", e);
    }
  }

  public String sign(String userId, String role) {
    Instant now = Instant.now();
    return Jwts.builder()
        .subject(userId)
        .claim("role", role)
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plusSeconds(props.getJwtTtlSeconds())))
        .signWith(key)
        .compact();
  }

  /** @return the {@code sub} claim, or throws {@code UNAUTHENTICATED}. */
  public String verifyAndGetSubject(String token) {
    try {
      Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
      String sub = claims.getSubject();
      if (sub == null || sub.isBlank()) {
        throw new AppException(ErrorCode.UNAUTHENTICATED, "Invalid or expired token");
      }
      return sub;
    } catch (AppException e) {
      throw e;
    } catch (Exception e) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, "Invalid or expired token");
    }
  }
}

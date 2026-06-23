package com.ticketforge.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Runtime configuration, bound from the environment. */
@Component
@ConfigurationProperties(prefix = "ticketforge")
public class AppProperties {

  /** HMAC secret for bearer tokens. */
  private String jwtSecret = "ticketforge-dev-secret-change-me";

  /** Token lifetime in seconds (default 12h). */
  private long jwtTtlSeconds = 12 * 60 * 60L;

  /** Seat-hold TTL in seconds. Contract default: 600. */
  private long holdTtlSeconds = 600L;

  /** Percentage component of the platform fee. Contract default: 5. */
  private long feePercent = 5L;

  /** Fixed component of the platform fee, in cents. Contract default: 30. */
  private long feeFixedCents = 30L;

  /** Hold-expiry worker interval, milliseconds. */
  private long holdExpiryIntervalMs = 1000L;

  /** Optional explicit path to the repo's {@code contract/} directory. */
  private String contractDir = "";

  public String getJwtSecret() {
    return jwtSecret;
  }

  public void setJwtSecret(String jwtSecret) {
    this.jwtSecret = jwtSecret;
  }

  public long getJwtTtlSeconds() {
    return jwtTtlSeconds;
  }

  public void setJwtTtlSeconds(long jwtTtlSeconds) {
    this.jwtTtlSeconds = jwtTtlSeconds;
  }

  public long getHoldTtlSeconds() {
    return holdTtlSeconds;
  }

  public void setHoldTtlSeconds(long holdTtlSeconds) {
    this.holdTtlSeconds = holdTtlSeconds;
  }

  public long getFeePercent() {
    return feePercent;
  }

  public void setFeePercent(long feePercent) {
    this.feePercent = feePercent;
  }

  public long getFeeFixedCents() {
    return feeFixedCents;
  }

  public void setFeeFixedCents(long feeFixedCents) {
    this.feeFixedCents = feeFixedCents;
  }

  public long getHoldExpiryIntervalMs() {
    return holdExpiryIntervalMs;
  }

  public void setHoldExpiryIntervalMs(long holdExpiryIntervalMs) {
    this.holdExpiryIntervalMs = holdExpiryIntervalMs;
  }

  public String getContractDir() {
    return contractDir;
  }

  public void setContractDir(String contractDir) {
    this.contractDir = contractDir;
  }
}

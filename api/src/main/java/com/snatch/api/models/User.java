package com.snatch.api.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonProperty.Access;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

@Entity
@Table(name = "users")
@Data
public class User {
    
    @Id
    private String email;
    
    @JsonProperty(access = Access.WRITE_ONLY)
    private String password;
    
    // "BEARER" or "BIDDER"
    private String role;
}

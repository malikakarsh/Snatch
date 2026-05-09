package com.snatch.api.controllers;

import java.util.Map;
import java.util.Optional;

import org.mindrot.jbcrypt.BCrypt;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.snatch.api.models.User;
import com.snatch.api.repositories.UserRepository;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody User user) {
        if (userRepository.existsById(user.getEmail())) {
            return ResponseEntity.badRequest().body(Map.of("message", "Email already exists"));
        }
        
        // Hash the password
        String hashed = BCrypt.hashpw(user.getPassword(), BCrypt.gensalt());
        user.setPassword(hashed);
        
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("message", "User registered successfully", "email", user.getEmail(), "role", user.getRole()));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> credentials) {
        String email = credentials.get("email");
        String password = credentials.get("password");
        
        if (email == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "Email and password are required"));
        }

        Optional<User> optionalUser = userRepository.findById(email);
        if (optionalUser.isPresent()) {
            User user = optionalUser.get();
            if (BCrypt.checkpw(password, user.getPassword())) {
                return ResponseEntity.ok(Map.of("message", "Login successful", "email", user.getEmail(), "role", user.getRole()));
            }
        }
        
        return ResponseEntity.status(401).body(Map.of("message", "Invalid email or password"));
    }
}

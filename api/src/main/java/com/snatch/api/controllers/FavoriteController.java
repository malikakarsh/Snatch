package com.snatch.api.controllers;

import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.Favorite;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.repositories.FavoriteRepository;

@RestController
@RequestMapping("/api")
public class FavoriteController {

    private final FavoriteRepository favoriteRepository;
    private final EngagementRepository engagementRepository;

    public FavoriteController(FavoriteRepository favoriteRepository,
                              EngagementRepository engagementRepository) {
        this.favoriteRepository = favoriteRepository;
        this.engagementRepository = engagementRepository;
    }

    @PostMapping("/engagements/{id}/favorite")
    public ResponseEntity<?> addFavorite(
            @PathVariable Long id,
            @RequestBody Map<String, String> payload) {
        String userEmail = payload.get("userEmail");
        if (userEmail == null || userEmail.isBlank()) {
            return ResponseEntity.badRequest().body("userEmail is required.");
        }

        Engagement engagement = engagementRepository.findById(id).orElse(null);
        if (engagement == null) return ResponseEntity.notFound().build();

        if (favoriteRepository.existsByUserEmailAndEngagementId(userEmail, id)) {
            return ResponseEntity.ok(Map.of("favorited", true, "message", "Already favorited"));
        }

        Favorite f = new Favorite();
        f.setUserEmail(userEmail);
        f.setEngagement(engagement);
        favoriteRepository.save(f);

        return ResponseEntity.ok(Map.of("favorited", true));
    }

    @DeleteMapping("/engagements/{id}/favorite")
    @Transactional
    public ResponseEntity<?> removeFavorite(
            @PathVariable Long id,
            @RequestParam String userEmail) {
        if (userEmail == null || userEmail.isBlank()) {
            return ResponseEntity.badRequest().body("userEmail is required.");
        }
        favoriteRepository.deleteByUserEmailAndEngagementId(userEmail, id);
        return ResponseEntity.ok(Map.of("favorited", false));
    }

    @GetMapping("/users/{email}/favorites")
    public ResponseEntity<List<Engagement>> listFavorites(@PathVariable String email) {
        return ResponseEntity.ok(favoriteRepository.findFavoriteEngagementsByUser(email));
    }
}
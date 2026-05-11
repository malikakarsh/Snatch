package com.snatch.api.repositories;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.Favorite;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public interface FavoriteRepository extends JpaRepository<Favorite, Long> {

    Optional<Favorite> findByUserEmailAndEngagementId(String userEmail, Long engagementId);

    boolean existsByUserEmailAndEngagementId(String userEmail, Long engagementId);

    @Transactional
    void deleteByUserEmailAndEngagementId(String userEmail, Long engagementId);

    // Latest-favorited first, per spec.
    @Query("SELECT f.engagement FROM Favorite f WHERE f.userEmail = :email ORDER BY f.favoritedAt DESC")
    List<Engagement> findFavoriteEngagementsByUser(@Param("email") String email);
}
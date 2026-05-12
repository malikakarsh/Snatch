package com.snatch.api.repositories;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.Registration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface RegistrationRepository extends JpaRepository<Registration, Long> {
    Optional<Registration> findByEngagementIdAndProviderId(Long engagementId, String providerId);

    // Returns all engagements a bidder has registered for (participated in), newest first.
    @Query("SELECT r.engagement FROM Registration r WHERE r.providerId = :providerId ORDER BY r.engagement.id DESC")
    List<Engagement> findEngagementsByProviderId(@Param("providerId") String providerId);

    List<Registration> findByEngagementIdAndWithdrawnFalse(Long engagementId);
}
package com.snatch.api.repositories;

import com.snatch.api.models.Registration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RegistrationRepository extends JpaRepository<Registration, Long> {
    Optional<Registration> findByEngagementIdAndProviderId(Long engagementId, String providerId);
}

package com.snatch.api.repositories;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.snatch.api.models.Engagement;

import jakarta.persistence.LockModeType;

@Repository
public interface EngagementRepository extends JpaRepository<Engagement, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT e FROM Engagement e WHERE e.id = :id")
    Optional<Engagement> findByIdWithPessimisticLock(@Param("id") Long id);
}
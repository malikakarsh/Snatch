package com.snatch.api.repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.snatch.api.models.Engagement;

@Repository
public interface EngagementRepository extends JpaRepository<Engagement, Long> {

}
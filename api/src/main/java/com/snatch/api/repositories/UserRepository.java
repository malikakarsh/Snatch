package com.snatch.api.repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.snatch.api.models.User;

@Repository
public interface UserRepository extends JpaRepository<User, String> {
}

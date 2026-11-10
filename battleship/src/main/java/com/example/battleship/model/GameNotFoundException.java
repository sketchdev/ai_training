package com.example.battleship.model;

public class GameNotFoundException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public GameNotFoundException(String id) {
        super("No game with id " + id);
    }
}

package com.example.battleship.model;

public enum GameStatus {
    /** The player is still placing ships. */
    SETUP,
    /** All ships are placed and shots are being fired. */
    IN_PROGRESS,
    /** One fleet is sunk. */
    FINISHED
}

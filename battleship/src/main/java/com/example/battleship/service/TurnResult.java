package com.example.battleship.service;

import com.example.battleship.model.Game;
import com.example.battleship.model.ShotOutcome;

/** The result of one full turn: the player's shot and the computer's reply, if there was one. */
public final class TurnResult {

    private final Game game;
    private final ShotOutcome playerShot;
    private final ShotOutcome computerShot;

    public TurnResult(Game game, ShotOutcome playerShot, ShotOutcome computerShot) {
        this.game = game;
        this.playerShot = playerShot;
        this.computerShot = computerShot;
    }

    public Game getGame() {
        return game;
    }

    public ShotOutcome getPlayerShot() {
        return playerShot;
    }

    /** Null when the player's shot ended the game. */
    public ShotOutcome getComputerShot() {
        return computerShot;
    }
}

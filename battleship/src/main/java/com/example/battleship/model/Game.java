package com.example.battleship.model;

import java.time.Instant;

/** One game between the player and the computer. */
public class Game {

    private final String id;
    private final Board playerBoard = new Board();
    private final Board computerBoard = new Board();
    private final Instant createdAt = Instant.now();
    private GameStatus status = GameStatus.SETUP;
    private Side winner;
    private int turns;

    public Game(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }

    public Board getPlayerBoard() {
        return playerBoard;
    }

    public Board getComputerBoard() {
        return computerBoard;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public GameStatus getStatus() {
        return status;
    }

    public Side getWinner() {
        return winner;
    }

    public int getTurns() {
        return turns;
    }

    public void requireSetup() {
        if (status != GameStatus.SETUP) {
            throw new IllegalStateException("Ships can only be placed during setup");
        }
    }

    /** Call after the player's board changes. Starts the game once the fleet is complete. */
    public void startIfReady() {
        if (status == GameStatus.SETUP && playerBoard.fleetComplete() && computerBoard.fleetComplete()) {
            status = GameStatus.IN_PROGRESS;
        }
    }

    /** Records the player's shot. */
    public ShotOutcome playerFire(Coordinate target) {
        if (status == GameStatus.SETUP) {
            throw new IllegalStateException("Place all ships before firing");
        }
        if (status == GameStatus.FINISHED) {
            throw new IllegalStateException("The game is over");
        }
        ShotOutcome outcome = computerBoard.fire(target);
        if (computerBoard.allSunk()) {
            finish(Side.PLAYER);
        }
        return outcome;
    }

    /** Records the computer's reply shot. Call only while the game is in progress. */
    public ShotOutcome computerFire(Coordinate target) {
        ShotOutcome outcome = playerBoard.fire(target);
        turns++;
        if (playerBoard.allSunk()) {
            finish(Side.COMPUTER);
        }
        return outcome;
    }

    private void finish(Side side) {
        status = GameStatus.FINISHED;
        winner = side;
    }
}

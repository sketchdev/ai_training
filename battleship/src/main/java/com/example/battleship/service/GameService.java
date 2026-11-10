package com.example.battleship.service;

import com.example.battleship.model.Coordinate;
import com.example.battleship.model.Game;
import com.example.battleship.model.GameNotFoundException;
import com.example.battleship.model.GameStatus;
import com.example.battleship.model.Orientation;
import com.example.battleship.model.ShipType;
import com.example.battleship.model.ShotOutcome;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Holds all games in memory. Games are lost when the application stops. */
@Service
public class GameService {

    private final Map<String, Game> games = new ConcurrentHashMap<>();
    private final ComputerOpponent computer;

    public GameService(ComputerOpponent computer) {
        this.computer = computer;
    }

    public Game create() {
        Game game = new Game(UUID.randomUUID().toString());
        computer.placeFleet(game.getComputerBoard());
        games.put(game.getId(), game);
        return game;
    }

    public Game get(String id) {
        Game game = games.get(id);
        if (game == null) {
            throw new GameNotFoundException(id);
        }
        return game;
    }

    public Game placeShip(String id, ShipType type, Coordinate start, Orientation orientation) {
        Game game = get(id);
        synchronized (game) {
            game.requireSetup();
            game.getPlayerBoard().placeShip(type, start, orientation);
            game.startIfReady();
            return game;
        }
    }

    /** Places every ship the player has not placed yet. */
    public Game placeRemainingShipsRandomly(String id) {
        Game game = get(id);
        synchronized (game) {
            game.requireSetup();
            computer.placeFleet(game.getPlayerBoard());
            game.startIfReady();
            return game;
        }
    }

    public TurnResult fire(String id, Coordinate target) {
        Game game = get(id);
        synchronized (game) {
            ShotOutcome playerShot = game.playerFire(target);
            if (game.getStatus() == GameStatus.FINISHED) {
                return new TurnResult(game, playerShot, null);
            }
            Coordinate reply = computer.chooseShot(game.getPlayerBoard());
            ShotOutcome computerShot = game.computerFire(reply);
            return new TurnResult(game, playerShot, computerShot);
        }
    }
}

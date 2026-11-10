package com.example.battleship.service;

import com.example.battleship.model.Board;
import com.example.battleship.model.Coordinate;
import com.example.battleship.model.Game;
import com.example.battleship.model.GameNotFoundException;
import com.example.battleship.model.GameStatus;
import org.junit.jupiter.api.Test;

import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GameServiceTest {

    private GameService newService() {
        return new GameService(new ComputerOpponent(new Random(42)));
    }

    @Test
    void newGameStartsInSetupWithComputerFleetPlaced() {
        Game game = newService().create();
        assertEquals(GameStatus.SETUP, game.getStatus());
        assertEquals(5, game.getComputerBoard().getShips().size());
    }

    @Test
    void randomPlacementStartsTheGame() {
        GameService service = newService();
        Game game = service.create();
        service.placeRemainingShipsRandomly(game.getId());
        assertEquals(GameStatus.IN_PROGRESS, game.getStatus());
    }

    @Test
    void cannotFireDuringSetup() {
        GameService service = newService();
        Game game = service.create();
        assertThrows(IllegalStateException.class, () -> service.fire(game.getId(), new Coordinate(0, 0)));
    }

    @Test
    void unknownGameIsNotFound() {
        assertThrows(GameNotFoundException.class, () -> newService().get("nope"));
    }

    @Test
    void playingEveryCellEndsTheGameWithAWinner() {
        GameService service = newService();
        Game game = service.create();
        service.placeRemainingShipsRandomly(game.getId());

        for (int r = 0; r < Board.SIZE && game.getStatus() != GameStatus.FINISHED; r++) {
            for (int c = 0; c < Board.SIZE && game.getStatus() != GameStatus.FINISHED; c++) {
                service.fire(game.getId(), new Coordinate(r, c));
            }
        }

        assertEquals(GameStatus.FINISHED, game.getStatus());
        assertNotNull(game.getWinner());
    }
}

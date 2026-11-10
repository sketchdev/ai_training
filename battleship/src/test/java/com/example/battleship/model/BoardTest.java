package com.example.battleship.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoardTest {

    @Test
    void placesShipHorizontally() {
        Board board = new Board();
        Ship ship = board.placeShip(ShipType.DESTROYER, new Coordinate(0, 0), Orientation.HORIZONTAL);
        assertEquals(2, ship.getCells().size());
        assertTrue(ship.occupies(new Coordinate(0, 1)));
    }

    @Test
    void rejectsShipThatRunsOffTheBoard() {
        Board board = new Board();
        assertThrows(IllegalArgumentException.class,
                () -> board.placeShip(ShipType.CARRIER, new Coordinate(0, 7), Orientation.HORIZONTAL));
    }

    @Test
    void missThenHitThenSunk() {
        Board board = new Board();
        board.placeShip(ShipType.DESTROYER, new Coordinate(2, 2), Orientation.VERTICAL);

        assertEquals(ShotResult.MISS, board.fire(new Coordinate(0, 0)).getResult());
        assertEquals(ShotResult.HIT, board.fire(new Coordinate(2, 2)).getResult());

        ShotOutcome last = board.fire(new Coordinate(3, 2));
        assertEquals(ShotResult.SUNK, last.getResult());
        assertEquals(ShipType.DESTROYER, last.getSunkShip());
        assertTrue(board.allSunk());
    }

    @Test
    void rejectsRepeatedShot() {
        Board board = new Board();
        board.fire(new Coordinate(4, 4));
        assertThrows(IllegalArgumentException.class, () -> board.fire(new Coordinate(4, 4)));
    }

    @Test
    void emptyBoardIsNotAllSunk() {
        assertFalse(new Board().allSunk());
    }
}

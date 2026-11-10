package com.example.battleship.service;

import com.example.battleship.model.Board;
import com.example.battleship.model.Coordinate;
import com.example.battleship.model.Orientation;
import com.example.battleship.model.ShipType;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** The computer player. It places ships at random and fires at random. */
@Component
public class ComputerOpponent {

    private final Random random;

    @Autowired
    public ComputerOpponent() {
        this(new Random());
    }

    /** Use a seeded Random in tests to get repeatable games. */
    public ComputerOpponent(Random random) {
        this.random = random;
    }

    /** Places every ship that is not on the board yet. */
    public void placeFleet(Board board) {
        for (ShipType type : ShipType.values()) {
            if (board.hasShip(type)) {
                continue;
            }
            boolean placed = false;
            while (!placed) {
                Coordinate start = new Coordinate(random.nextInt(Board.SIZE), random.nextInt(Board.SIZE));
                Orientation orientation = random.nextBoolean() ? Orientation.HORIZONTAL : Orientation.VERTICAL;
                try {
                    board.placeShip(type, start, orientation);
                    placed = true;
                } catch (IllegalArgumentException notFree) {
                    // try another spot
                }
            }
        }
    }

    /** Picks a random cell that has not been fired at yet. */
    public Coordinate chooseShot(Board target) {
        List<Coordinate> open = new ArrayList<>();
        for (int r = 0; r < Board.SIZE; r++) {
            for (int c = 0; c < Board.SIZE; c++) {
                Coordinate candidate = new Coordinate(r, c);
                if (!target.getShotsReceived().contains(candidate)) {
                    open.add(candidate);
                }
            }
        }
        if (open.isEmpty()) {
            throw new IllegalStateException("No cells left to fire at");
        }
        return open.get(random.nextInt(open.size()));
    }
}

package com.example.battleship.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** One side's 10 by 10 grid: its ships and the shots fired at it. */
public class Board {

    public static final int SIZE = 10;

    private final List<Ship> ships = new ArrayList<>();
    private final Set<Coordinate> shotsReceived = new LinkedHashSet<>();

    public static boolean inBounds(Coordinate c) {
        return c.getRow() >= 0 && c.getRow() < SIZE && c.getCol() >= 0 && c.getCol() < SIZE;
    }

    public Ship placeShip(ShipType type, Coordinate start, Orientation orientation) {
        if (hasShip(type)) {
            throw new IllegalArgumentException(type + " is already placed");
        }
        List<Coordinate> cells = new ArrayList<>();
        for (int i = 0; i < type.getLength(); i++) {
            Coordinate c = orientation == Orientation.HORIZONTAL
                    ? new Coordinate(start.getRow(), start.getCol() + i)
                    : new Coordinate(start.getRow() + i, start.getCol());
            if (!inBounds(c)) {
                throw new IllegalArgumentException(type + " does not fit on the board at " + start);
            }
            if (shipAt(c) != null) {
                throw new IllegalArgumentException(type + " overlaps another ship at " + c);
            }
            cells.add(c);
        }
        Ship ship = new Ship(type, cells);
        ships.add(ship);
        return ship;
    }

    public ShotOutcome fire(Coordinate target) {
        if (!inBounds(target)) {
            throw new IllegalArgumentException("Shot is outside the board: " + target);
        }
        if (!shotsReceived.add(target)) {
            throw new IllegalArgumentException("Already fired at " + target);
        }
        Ship ship = shipAt(target);
        if (ship == null) {
            return new ShotOutcome(target, ShotResult.MISS, null);
        }
        ship.hit(target);
        if (ship.isSunk()) {
            return new ShotOutcome(target, ShotResult.SUNK, ship.getType());
        }
        return new ShotOutcome(target, ShotResult.HIT, null);
    }

    public boolean hasShip(ShipType type) {
        for (Ship s : ships) {
            if (s.getType() == type) {
                return true;
            }
        }
        return false;
    }

    public Ship shipAt(Coordinate c) {
        for (Ship s : ships) {
            if (s.occupies(c)) {
                return s;
            }
        }
        return null;
    }

    public boolean isHit(Coordinate shot) {
        return shipAt(shot) != null;
    }

    public boolean fleetComplete() {
        return ships.size() == ShipType.values().length;
    }

    public boolean allSunk() {
        if (ships.isEmpty()) {
            return false;
        }
        for (Ship s : ships) {
            if (!s.isSunk()) {
                return false;
            }
        }
        return true;
    }

    public List<Ship> getShips() {
        return Collections.unmodifiableList(ships);
    }

    public Set<Coordinate> getShotsReceived() {
        return Collections.unmodifiableSet(shotsReceived);
    }
}

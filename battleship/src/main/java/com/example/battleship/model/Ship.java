package com.example.battleship.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class Ship {

    private final ShipType type;
    private final List<Coordinate> cells;
    private final Set<Coordinate> hits = new HashSet<>();

    public Ship(ShipType type, List<Coordinate> cells) {
        this.type = type;
        this.cells = new ArrayList<>(cells);
    }

    public ShipType getType() {
        return type;
    }

    public List<Coordinate> getCells() {
        return Collections.unmodifiableList(cells);
    }

    public boolean occupies(Coordinate c) {
        return cells.contains(c);
    }

    public void hit(Coordinate c) {
        if (!occupies(c)) {
            throw new IllegalArgumentException(type + " is not at " + c);
        }
        hits.add(c);
    }

    public boolean isSunk() {
        return hits.size() == cells.size();
    }
}

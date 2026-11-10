package com.example.battleship.model;

/** What happened when one shot landed. {@code sunkShip} is set only when the result is SUNK. */
public final class ShotOutcome {

    private final Coordinate target;
    private final ShotResult result;
    private final ShipType sunkShip;

    public ShotOutcome(Coordinate target, ShotResult result, ShipType sunkShip) {
        this.target = target;
        this.result = result;
        this.sunkShip = sunkShip;
    }

    public Coordinate getTarget() {
        return target;
    }

    public ShotResult getResult() {
        return result;
    }

    public ShipType getSunkShip() {
        return sunkShip;
    }
}

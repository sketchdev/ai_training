package com.example.battleship.web;

import com.example.battleship.model.Orientation;
import com.example.battleship.model.ShipType;

import javax.validation.constraints.NotNull;

public class PlaceShipRequest {

    @NotNull
    private ShipType type;
    @NotNull
    private Integer row;
    @NotNull
    private Integer col;
    @NotNull
    private Orientation orientation;

    public ShipType getType() {
        return type;
    }

    public void setType(ShipType type) {
        this.type = type;
    }

    public Integer getRow() {
        return row;
    }

    public void setRow(Integer row) {
        this.row = row;
    }

    public Integer getCol() {
        return col;
    }

    public void setCol(Integer col) {
        this.col = col;
    }

    public Orientation getOrientation() {
        return orientation;
    }

    public void setOrientation(Orientation orientation) {
        this.orientation = orientation;
    }
}

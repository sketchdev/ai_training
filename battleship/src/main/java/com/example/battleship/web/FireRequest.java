package com.example.battleship.web;

import javax.validation.constraints.NotNull;

public class FireRequest {

    @NotNull
    private Integer row;
    @NotNull
    private Integer col;

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
}

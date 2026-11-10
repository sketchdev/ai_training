package com.example.battleship.web;

import com.example.battleship.model.ShipType;
import com.example.battleship.model.ShotOutcome;
import com.example.battleship.model.ShotResult;
import com.example.battleship.service.TurnResult;

public class ShotResponse {

    private final ShotDetail playerShot;
    private final ShotDetail computerShot;
    private final GameView game;

    private ShotResponse(TurnResult turn) {
        this.playerShot = ShotDetail.of(turn.getPlayerShot());
        this.computerShot = ShotDetail.of(turn.getComputerShot());
        this.game = GameView.of(turn.getGame());
    }

    public static ShotResponse of(TurnResult turn) {
        return new ShotResponse(turn);
    }

    public ShotDetail getPlayerShot() {
        return playerShot;
    }

    /** Null when the player's shot ended the game. */
    public ShotDetail getComputerShot() {
        return computerShot;
    }

    public GameView getGame() {
        return game;
    }

    public static class ShotDetail {
        private final int row;
        private final int col;
        private final ShotResult result;
        private final ShipType sunkShip;

        private ShotDetail(ShotOutcome outcome) {
            this.row = outcome.getTarget().getRow();
            this.col = outcome.getTarget().getCol();
            this.result = outcome.getResult();
            this.sunkShip = outcome.getSunkShip();
        }

        static ShotDetail of(ShotOutcome outcome) {
            return outcome == null ? null : new ShotDetail(outcome);
        }

        public int getRow() {
            return row;
        }

        public int getCol() {
            return col;
        }

        public ShotResult getResult() {
            return result;
        }

        public ShipType getSunkShip() {
            return sunkShip;
        }
    }
}

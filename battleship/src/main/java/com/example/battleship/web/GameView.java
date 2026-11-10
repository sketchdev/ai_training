package com.example.battleship.web;

import com.example.battleship.model.Board;
import com.example.battleship.model.Coordinate;
import com.example.battleship.model.Game;
import com.example.battleship.model.GameStatus;
import com.example.battleship.model.Ship;
import com.example.battleship.model.ShipType;
import com.example.battleship.model.Side;

import java.util.ArrayList;
import java.util.List;

/** JSON view of a game. The enemy board never shows ship positions. */
public class GameView {

    private final String id;
    private final GameStatus status;
    private final Side winner;
    private final int turns;
    private final YourBoard yourBoard;
    private final EnemyBoard enemyBoard;

    private GameView(Game game) {
        this.id = game.getId();
        this.status = game.getStatus();
        this.winner = game.getWinner();
        this.turns = game.getTurns();
        this.yourBoard = new YourBoard(game.getPlayerBoard());
        this.enemyBoard = new EnemyBoard(game.getComputerBoard());
    }

    public static GameView of(Game game) {
        return new GameView(game);
    }

    public String getId() {
        return id;
    }

    public GameStatus getStatus() {
        return status;
    }

    public Side getWinner() {
        return winner;
    }

    public int getTurns() {
        return turns;
    }

    public YourBoard getYourBoard() {
        return yourBoard;
    }

    public EnemyBoard getEnemyBoard() {
        return enemyBoard;
    }

    public static class ShipView {
        private final ShipType type;
        private final List<Coordinate> cells;
        private final boolean sunk;

        ShipView(Ship ship) {
            this.type = ship.getType();
            this.cells = ship.getCells();
            this.sunk = ship.isSunk();
        }

        public ShipType getType() {
            return type;
        }

        public List<Coordinate> getCells() {
            return cells;
        }

        public boolean isSunk() {
            return sunk;
        }
    }

    public static class ShotView {
        private final int row;
        private final int col;
        private final boolean hit;

        ShotView(Coordinate c, boolean hit) {
            this.row = c.getRow();
            this.col = c.getCol();
            this.hit = hit;
        }

        public int getRow() {
            return row;
        }

        public int getCol() {
            return col;
        }

        public boolean isHit() {
            return hit;
        }
    }

    public static class YourBoard {
        private final List<ShipView> ships = new ArrayList<>();
        private final List<ShotView> shotsAgainstYou = new ArrayList<>();

        YourBoard(Board board) {
            for (Ship s : board.getShips()) {
                ships.add(new ShipView(s));
            }
            for (Coordinate c : board.getShotsReceived()) {
                shotsAgainstYou.add(new ShotView(c, board.isHit(c)));
            }
        }

        public List<ShipView> getShips() {
            return ships;
        }

        public List<ShotView> getShotsAgainstYou() {
            return shotsAgainstYou;
        }
    }

    public static class EnemyBoard {
        private final List<ShotView> shotsByYou = new ArrayList<>();
        private final List<ShipType> sunkShips = new ArrayList<>();
        private final int shipsRemaining;

        EnemyBoard(Board board) {
            for (Coordinate c : board.getShotsReceived()) {
                shotsByYou.add(new ShotView(c, board.isHit(c)));
            }
            int remaining = 0;
            for (Ship s : board.getShips()) {
                if (s.isSunk()) {
                    sunkShips.add(s.getType());
                } else {
                    remaining++;
                }
            }
            this.shipsRemaining = remaining;
        }

        public List<ShotView> getShotsByYou() {
            return shotsByYou;
        }

        public List<ShipType> getSunkShips() {
            return sunkShips;
        }

        public int getShipsRemaining() {
            return shipsRemaining;
        }
    }
}

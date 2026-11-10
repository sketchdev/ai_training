package com.example.battleship.web;

import com.example.battleship.model.Coordinate;
import com.example.battleship.model.Game;
import com.example.battleship.service.GameService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.net.URI;

@RestController
@RequestMapping("/api/games")
public class GameController {

    private final GameService games;

    public GameController(GameService games) {
        this.games = games;
    }

    @PostMapping
    public ResponseEntity<GameView> create() {
        Game game = games.create();
        return ResponseEntity.created(URI.create("/api/games/" + game.getId())).body(GameView.of(game));
    }

    @GetMapping("/{id}")
    public GameView get(@PathVariable String id) {
        return GameView.of(games.get(id));
    }

    @PostMapping("/{id}/ships")
    public GameView placeShip(@PathVariable String id, @Valid @RequestBody PlaceShipRequest request) {
        Game game = games.placeShip(id, request.getType(),
                new Coordinate(request.getRow(), request.getCol()), request.getOrientation());
        return GameView.of(game);
    }

    @PostMapping("/{id}/ships/random")
    public GameView placeRandomly(@PathVariable String id) {
        return GameView.of(games.placeRemainingShipsRandomly(id));
    }

    @PostMapping("/{id}/shots")
    public ShotResponse fire(@PathVariable String id, @Valid @RequestBody FireRequest request) {
        return ShotResponse.of(games.fire(id, new Coordinate(request.getRow(), request.getCol())));
    }
}

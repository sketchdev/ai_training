package com.example.battleship.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class GameControllerTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    private String createGame() throws Exception {
        String body = mvc.perform(post("/api/games"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("SETUP"))
                .andReturn().getResponse().getContentAsString();
        JsonNode node = json.readTree(body);
        return node.get("id").asText();
    }

    @Test
    void createPlaceAndFire() throws Exception {
        String id = createGame();

        mvc.perform(post("/api/games/" + id + "/ships/random"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.yourBoard.ships.length()").value(5));

        mvc.perform(post("/api/games/" + id + "/shots")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"row\":0,\"col\":0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playerShot.result").exists())
                .andExpect(jsonPath("$.computerShot.result").exists());
    }

    @Test
    void enemyShipPositionsAreNotExposed() throws Exception {
        String id = createGame();
        mvc.perform(get("/api/games/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enemyBoard.ships").doesNotExist())
                .andExpect(jsonPath("$.enemyBoard.shipsRemaining").value(5));
    }

    @Test
    void unknownGameReturns404() throws Exception {
        mvc.perform(get("/api/games/does-not-exist"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void firingBeforePlacementReturns409() throws Exception {
        String id = createGame();
        mvc.perform(post("/api/games/" + id + "/shots")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"row\":0,\"col\":0}"))
                .andExpect(status().isConflict());
    }

    @Test
    void missingFieldReturns400() throws Exception {
        String id = createGame();
        mvc.perform(post("/api/games/" + id + "/shots")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"row\":0}"))
                .andExpect(status().isBadRequest());
    }
}

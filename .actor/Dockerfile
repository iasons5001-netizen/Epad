FROM apify/actor-node-playwright-chrome:22-1.62.1

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && npm list --omit=dev --all \
    && rm -rf /home/myuser/.npm

COPY --chown=myuser:myuser . ./

CMD npm start --silent

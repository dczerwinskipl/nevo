using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
});

// nEvo — Level 1 convention handling for Document commands is wired via
// AddEventSourcing(typeof(Document)); HTTP endpoints (MapCommandEndpoint/
// MapQueryEndpoint), the explicit Level 2 handler, and authorization are added once
// their own tasks land.
builder.Services.AddMessages();
builder.Services.AddMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
builder.Services.AddCommands();
builder.Services.AddQueries();
builder.Services.AddEventSourcing(typeof(Document));
builder.Services.AddDocumentsDomain();

var app = builder.Build();

app.MapDefaultEndpoints();

app.Run();

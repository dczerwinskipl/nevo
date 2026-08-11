using NEvo.ExampleApp.Documents.Api;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Handling.Middleware;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
});

// The aggregate-method convention handles Document commands via
// AddEventSourcing(typeof(Document)) — no explicit handler registration needed for it.
builder.Services.AddMessages();
builder.Services.AddMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
builder.Services.AddCommands();
builder.Services.AddQueries();
builder.Services.AddEventSourcing(typeof(Document));
builder.Services.AddDocumentsDomain();

var app = builder.Build();

app.MapDefaultEndpoints();

app.Run();

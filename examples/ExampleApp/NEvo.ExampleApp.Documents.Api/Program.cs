using NEvo.ExampleApp.Documents.Api;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Handling.Middleware;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
});

builder.Services.AddMessages();
builder.Services.AddMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
builder.Services.AddEvents();
builder.Services.AddCommands();
builder.Services.AddQueries();

builder.Services.AddEventSourcing(options => options.UseAggregateMethodFallback = true, typeof(Document));
builder.Services.AddDocumentsDomain();
builder.Services.AddDocumentsAuthorization();

var app = builder.Build();

app.MapDefaultEndpoints();

app.UseAuthentication();
app.UseAuthorization();

app.MapDocumentsRoutes();

app.Run();

using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Logging;
using Microsoft.IdentityModel.Tokens;
using NEvo.ExampleApp.ServiceA.Api.Database;
using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;
using NEvo.Messaging.Handling.Middleware;
using Polly;

IdentityModelEventSource.ShowPII = true;

const string AppName = "NEvo.ExampleApp.ServiceA.Api";

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// logging
builder.Services.AddLogging(logging =>
{
    logging.AddConsole();
});

// database
builder.AddSqlServerDbContext<ExampleDbContext>("ServiceASql", settings => settings.Retry = false);

// nEvo (TODO: presets)
builder.Services.AddMessages();
builder.Services.AddMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
builder.Services.AddEvents();
builder.Services.AddCommands();
builder.Services.AddRestMessageDispatcher((opts) =>
{
    opts.Name = "ServiceB/RestMessageDispatcher";
    opts.BaseAddress = new Uri("http://ServiceB/api/messages/");
}, [typeof(ServiceBCommand)]);


// nEvo Inbox, maybe single method + config like UseEntityFramework<TContext>?
// example api: nEvoBuilder.UseInbox(options => options.UseEntityFramework<ExampleDbContext>());
builder.Services.AddMessageProcessingMiddleware<TransactionScopeMessageProcessingMiddleware>();
builder.Services.AddMessageProcessingMiddleware<InboxMessageProcessingMiddleware>();
builder.Services.AddMessageProcessingHandlerMiddleware<InboxMessageProcessingMiddleware>();
builder.Services.AddEntityFrameworkInbox<ExampleDbContext>();

// auth
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = "Bearer";
        options.DefaultChallengeScheme = "Bearer";
    })
    .AddJwtBearer("Bearer", options =>
    {
        options.Authority = "https://Identity";
        options.RequireHttpsMetadata = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
        };
    });

builder.Services.AddAuthorization();

// swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(setup =>
{
    setup.SwaggerDoc("v1", new() { Title = AppName, Version = "v1" });
});

var app = builder.Build();

app.MapDefaultEndpoints();

app.UseAuthentication();
app.UseAuthorization();

// register handlers (TODO: change to setup of messaging)
var registry = app.Services.GetRequiredService<IMessageHandlerRegistry>();
registry.UseServiceADomain();

// app routes
app.MapServiceARoutes();

// swagger
app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "v1");
    options.RoutePrefix = string.Empty;
});

// db migration
var logger = app.Services.GetRequiredService<ILogger<Program>>();
var retryPolicy = Policy
    .Handle<Exception>()
    .WaitAndRetryAsync(
        10,
        retryAttempt => TimeSpan.FromSeconds(retryAttempt),
        onRetry: (exception, timeSpan, retryCount, context) =>
        {
            logger.LogWarning($"Retry {retryCount}: Encountered an error during DB migration. Retrying...");
            logger.LogWarning($"Exception: {exception.Message}");
        });

await retryPolicy.ExecuteAsync(async () =>
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<ExampleDbContext>();
    await dbContext.Database.MigrateAsync();
});

app.Run();

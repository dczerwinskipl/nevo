using Microsoft.IdentityModel.Logging;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Net.Http.Headers;
using Microsoft.OpenApi.Models;
using NEvo.ExampleApp.ServiceA.Api.Database;
using NEvo.ExampleApp.ServiceB.Api.ExampleDomain;
using NEvo.Messaging.Handling.Middleware;

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
builder.Services.AddMigrationWorker<ExampleDbContext>();

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
        options.Authority = builder.Configuration.GetValue<string>("IdentityUrl");
        options.RequireHttpsMetadata = true;
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
    setup.AddSecurityDefinition(
        "oauth",
        new OpenApiSecurityScheme
        {
            Flows = new OpenApiOAuthFlows
            {
                Password = new OpenApiOAuthFlow
                {
                    Scopes = new Dictionary<string, string>
                    {
                        ["api"] = ""
                    },
                    TokenUrl = new Uri($"{builder.Configuration.GetValue<string>("IdentityUrl")}/connect/token"),
                },
            },
            In = ParameterLocation.Header,
            Name = HeaderNames.Authorization,
            Type = SecuritySchemeType.OAuth2
        }
    );
    setup.AddSecurityRequirement(
        new OpenApiSecurityRequirement
        {
            {
                new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "oauth" },
                },
                new[] { "api" }
            }
        }
    );
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

app.Run();

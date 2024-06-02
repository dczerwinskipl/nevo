var builder = DistributedApplication.CreateBuilder(args);
var sqlServerPassword = builder.AddResource(new ParameterResource("sqlServerPassword", _ => "b~Q3XEHg}BvdNt1c", false));
var sqlServer = builder.AddSqlServer("sql", sqlServerPassword, 65104)
    .WithDataVolume()
    .PublishAsContainer();

// identity
var indentitySql = sqlServer.AddDatabase("IdentitySql");
var identity = builder.AddProject<Projects.NEvo_ExampleApp_Identity_Api>("Identity")
    // owned resources
    .WithReference(indentitySql);

var identityHttps = identity.GetEndpoint("https");

// Service B
var serviceBSql = sqlServer.AddDatabase("ServiceBSql");
var serviceB = builder.AddProject<Projects.NEvo_ExampleApp_ServiceB_Api>("ServiceB")
    // owned resources
    .WithReference(serviceBSql)
    // generic services
    .WithEnvironment("IdentityUrl", identityHttps);

// Service A
var servicASql = sqlServer.AddDatabase("ServiceASql");
builder.AddProject<Projects.NEvo_ExampleApp_ServiceA_Api>("ServiceA")
    // owned resources
    .WithReference(servicASql)
    // generic services
    .WithEnvironment("IdentityUrl", identityHttps)
    // deps
    .WithReference(serviceB);


builder.Build().Run();

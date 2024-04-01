var builder = DistributedApplication.CreateBuilder(args);
var sqlServer = builder.AddSqlServer("sql", "b~Q3XEHg}BvdNt1c", 65104)
    .WithVolumeMount("VolumeMount.sqlserver.data", "/var/opt/mssql")
    .PublishAsContainer();

// identity
var indentitySql = sqlServer.AddDatabase("IdentitySql");
var identity = builder.AddProject<Projects.NEvo_ExampleApp_Identity_Api>("Identity")
    // owner resources
    .WithReference(indentitySql);

// Service B
var serviceBSql = sqlServer.AddDatabase("ServiceBSql");
var serviceB = builder.AddProject<Projects.NEvo_ExampleApp_ServiceB_Api>("ServiceB")
    // owned resources
    .WithReference(serviceBSql)
    // generic services
    .WithReference(identity);

// Service A
var servicASql = sqlServer.AddDatabase("ServiceASql");
builder.AddProject<Projects.NEvo_ExampleApp_ServiceA_Api>("ServiceA")
    // owned resources
    .WithReference(servicASql)
    // generic services
    .WithReference(identity)
    // deps
    .WithReference(serviceB);


builder.Build().Run();

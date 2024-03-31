var builder = DistributedApplication.CreateBuilder(args);
var sqlServer = builder.AddSqlServer("sql", "b~Q3XEHg}BvdNt1c");

// Service B
var sqlB = sqlServer.AddDatabase("ServiceBSql");
var serviceB = builder.AddProject<Projects.NEvo_ExampleApp_ServiceB_Api>("ServiceB")
    .WithReference(sqlB);

// Service A
var sqlA = sqlServer.AddDatabase("ServiceASql");
builder.AddProject<Projects.NEvo_ExampleApp_ServiceA_Api>("ServiceA")
    .WithReference(sqlA)
    .WithReference(serviceB);


builder.Build().Run();

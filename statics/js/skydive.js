/*
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

var switchImg = 'statics/img/switch.png';
var portImg = 'statics/img/port.png';
var intfImg = 'statics/img/intf.png';
var vethImg = 'statics/img/veth.png';
var nsImg = 'statics/img/ns.png';
var bridgeImg = 'statics/img/bridge.png';
var dockerImg = 'statics/img/docker.png';
var neutronImg = 'statics/img/openstack.png';

var Node = function(ID) {
  this.ID = ID;
  this.Host = '';
  this.Metadata = {};
  this.Edges = {};
}
var alerts = {};

Node.prototype.Type = function() {
  if ("Type" in this.Metadata)
    return this.Metadata["Type"];
  return "";
}

Node.prototype.Name = function() {
  if ("Name" in this.Metadata)
    return this.Metadata["Name"];
  return "";
}

Node.prototype.getHostRelativePath = function(path, visited) {
  visited[this.ID] = true;

  path = path.slice();

  path.push(this);
  if (this.Type() == "host")
    return path;

  var shortest = [];
  for (var e in this.Edges) {
    var edge = this.Edges[e];
    if (edge.RelationType() != "ownership")
      continue;

    var neighbor;
    if (edge.Parent.ID != this.ID && !(edge.Parent.ID in visited))
      neighbor = edge.Parent;

    if (edge.Child.ID != this.ID && !(edge.Child.ID in visited))
      neighbor = edge.Child;

    if (typeof neighbor != "undefined") {
      var sub = neighbor.getHostRelativePath(path, visited);
      if (sub.length > 0 && (shortest.length == 0 || sub.length < shortest.length))
        shortest = sub;
    }
  }

  return shortest;
}

Node.prototype.GetHostRelativePath = function() {
  nodes = this.getHostRelativePath([], {});
  if (nodes.length == 0)
    return "";

  var path = ""
  for (i in nodes.reverse()) {
    var node = nodes[i];

    if (path.length > 0)
      path += "/";

    path += node.Name() + "[Type=" + node.Type() + "]";
  }

  return path;
}

var Edge = function(ID) {
  this.ID = ID;
  this.Host = '';
  this.Parent = '';
  this.Child = '';
  this.Metadata = {};
}

Edge.prototype.Type = function() {
  if ("Type" in this.Metadata)
    return this.Metadata["Type"];
  return "";
}

Edge.prototype.RelationType = function() {
  if ("RelationType" in this.Metadata)
    return this.Metadata["RelationType"];
  return "";
}

var Graph = function(ID) {
  this.Nodes = {};
  this.Edges = {};
};

Graph.prototype.NewNode = function(ID, host) {
  var node = new Node(ID);
  node.Graph = this;
  node.Host = host;

  this.Nodes[ID] = node;

  return node;
}

Graph.prototype.GetNode = function(ID) {
  return this.Nodes[ID];
}

Graph.prototype.GetEdge = function(ID) {
  return this.Edges[ID];
}

Graph.prototype.NewEdge = function(ID, parent, child, host) {
  var edge = new Edge(ID);
  edge.Parent = parent;
  edge.Child = child;
  edge.Graph = this;
  edge.Host = host;

  this.Edges[ID] = edge;

  parent.Edges[ID] = edge;
  child.Edges[ID] = edge;

  return edge;
}

Graph.prototype.DelNode = function(node) {
  for (i in node.Edges) {
    this.DelEdge(this.Edges[i]);
  }

  delete this.Nodes[node.ID];
}

Graph.prototype.DelEdge = function(edge) {
  delete edge.Parent.Edges[edge.ID];
  delete edge.Child.Edges[edge.ID];
  delete this.Edges[edge.ID];
}

Graph.prototype.InitFromSyncMessage = function(msg) {
  var g = msg.Obj;

  for (var i in g.Nodes) {
    var n = g.Nodes[i];

    var node = this.NewNode(n.ID);
    if ("Metadata" in n)
      node.Metadata = n["Metadata"];
    node.Host = n["Host"];
  }

  for (var i in g.Edges) {
    var e = g.Edges[i];

    var parent = this.GetNode(e["Parent"]);
    var child = this.GetNode(e["Child"]);

    var edge = this.NewEdge(e.ID, parent, child);

    if ("Metadata" in e)
      edge.Metadata = e["Metadata"];
    edge.Host = e["Host"];
  }
}

var HostLayout = function(ID, graph, svg) {
  this.width = 680;
  this.height = 680;
  this.graph = graph;
  this.hullOffset = 22;
  this.elements = {};

  var _this = this;

  this.force = d3.layout.force()
  .size([this.width, this.height])
  .charge(-900)
  .linkDistance(50)
  .gravity(0.35)
  .on("tick", function(e) {
    _this.Tick(e);
  });

  this.container = svg.append("svg")
  .attr("width", this.width)
  .attr("height", this.height)
  .attr("viewBox", "0 0 " + this.width + " " + this.height);

  this.container.append("rect")
  .attr("x", 10)
  .attr("y", 10)
  .attr("width", this.width - 10)
  .attr("height", this.height - 10)
  .attr("rx", 10)
  .attr("class", "host");

  this.container.append("text")
  .attr("x", 30)
  .attr("y", 45)
  .attr("class", "group")
  .text(ID);

  this.hullG = this.container.append("g");

  this.nodes = this.force.nodes();
  this.links = this.force.links();

  var elemG = this.container.append("g");
  this.node = elemG.selectAll(".node");
  this.link = elemG.selectAll(".link");
}

HostLayout.prototype.GetBBox = function() {
  return this.container.node().getBBox();
}

HostLayout.prototype.SetPosition = function(x, y) {
  this.container.attr("x", x).attr("y", y);
}

HostLayout.prototype.NodeDetails = function(node) {
  var json = JSON.stringify(node.Metadata);
  $("#metadata").JSONView(json);

  var graphPath = node.GetHostRelativePath();
  if (graphPath != "") {
    $.ajax({
      dataType: "json",
      url: '/api/flow/search?ProbeGraphPath=' + graphPath,
      success: function(data) {
        var json = JSON.stringify(data);
        $("#flows").JSONView(json);
        $('#flows').JSONView('toggle', 3);
      }
    });
  }

  $(".title-capture-switch").show();
  $("[name='capture-switch']").bootstrapSwitch("destroy");
  $("[name='capture-switch']").bootstrapSwitch({
    onSwitchChange: function(event, state) {
      if (state) {
        $.ajax({
          dataType: "json",
          url: '/api/capture',
          data: JSON.stringify({"ProbePath": graphPath}),
          contentType: "application/json; charset=utf-8",
          method: 'POST',
        });
      } else {
        $.ajax({
          url: '/api/capture/' + graphPath,
          contentType: "application/json; charset=utf-8",
          method: 'DELETE',
        });
      }
      return true;
    }
  });

  $.ajax({
    dataType: "json",
    url: '/api/capture/' + graphPath,
    contentType: "application/json; charset=utf-8",
    method: 'GET',
    success: function(data) {
      $("[name='capture-switch']").bootstrapSwitch('state', true, false);
    },
    error: function(data) {
      $("[name='capture-switch']").bootstrapSwitch('state', false, false);
    }
  });
}

HostLayout.prototype.AddNode = function(node) {
  if (node.ID in this.elements)
    return;
  this.elements[node.ID] = node;

  if (node.Type() == "host")
    return;

  this.nodes.push(node);

  this.Redraw();
}

HostLayout.prototype.DelNode = function(node) {
  if (!(node.ID in this.elements))
    return;

  for (var i in this.nodes) {
    if (this.nodes[i].ID == node.ID) {
      this.nodes.splice(i, 1);
      break;
    }
  }
  delete this.elements[node.ID];

  this.Redraw();
}

HostLayout.prototype.AddEdge = function(edge) {
  if (edge.ID in this.elements)
    return;
  this.elements[edge.ID] = edge;

  if (edge.Parent.Type() == "host")
    return;

  this.links.push({source: edge.Parent, target: edge.Child, edge: edge});
  this.Redraw();
}

HostLayout.prototype.DelEdge = function(edge) {
  if (!(edge.ID in this.elements))
    return;

  for (var i in this.links) {
    if (this.links[i]["source"].ID == edge.Parent.ID &&
      this.links[i]["target"].ID == edge.Child.ID)
    this.links.splice(i, 1);
  }
  delete this.elements[edge.ID];

  this.Redraw();
}

HostLayout.prototype.Tick = function(e) {
  var k = 1 * e.alpha;

  this.link.each(function(d) { d.source.y -= k, d.target.y += k; })
  .attr("x1", function(d) { return d.source.x; })
  .attr("y1", function(d) { return d.source.y; })
  .attr("x2", function(d) { return d.target.x; })
  .attr("y2", function(d) { return d.target.y; });

  this.node.attr("cx", function(d) { return d.x; })
  .attr("cy", function(d) { return d.y; });

  this.node.attr("transform", function(d) {
    return "translate(" + d.x + "," + d.y + ")";
  });

  var _this = this;
  if (!this.hull.empty())
    this.hull.data(this.GetConvexHulls()).attr("d", function(d) {
      return _this.DrawCluster(d)
    });
}

HostLayout.prototype.CircleSize = function(d) {
  switch(d.Type()) {
    case "ovsport":
    return 18;
    case "ovsbridge":
    return 20;
    default:
    return 16;
  }
}

HostLayout.prototype.NodeClass = function(d) {
  if (d.ID in alerts)
    return "alert"

  if (d.Metadata["State"] == "DOWN")
    return "down";

  switch(d.Type()) {
    case "ovsbridge":
      return "ovsbridge";
    case "ovsport":
      return "ovsport";
    case "bond":
      return "bond";
    case "bridge":
      return "bridge";
    default:
      return "default";
  }
}

HostLayout.prototype.LinkClass = function(d) {
  edge = d.edge;

  if (edge.Type() == "")
    return "link";

  switch(edge.Type()) {
    case "veth":
      return "link veth";
    default:
      return "link";
  }
}

HostLayout.prototype.CircleOpacity = function(d) {
  if (d.Metadata["Type"] == "netns" && d.Metadata["Manager"] == null)
    return 0.0;
  return 1.0;
}

HostLayout.prototype.EdgeOpacity = function(d) {
  var parent = d.source;
  var child = d.target;

  if (parent.Metadata["Type"] == "netns" ||
    child.Metadata["Type"] == "netns")
    return 0.0;

  return 1.0;
}

HostLayout.prototype.NodePicto = function(d) {
  switch(d.Metadata["Manager"]) {
    case "docker":
      return dockerImg;
    case "neutron":
      return neutronImg;
  }
  switch(d.Metadata["Type"]) {
    case "ovsport":
      return portImg;
    case "bridge":
      return bridgeImg;
    case "ovsbridge":
      return switchImg;
    case "netns":
      return nsImg;
    case "veth":
      return vethImg;
    case "bond":
      return portImg;
    default:
      return intfImg;
  }
}

HostLayout.prototype.GetParentNode = function(node) {
  var parent;

  for (var i in node.Edges) {
    var edge = node.Edges[i];
    var type = edge.Type();
    if (type == "patch" || type == "veth")
      continue;

    if (edge.Parent == node)
      continue;

    var type = edge.Parent.Type();
    if (type == "host" || type == "netns")
      return edge.Parent;

    parent = edge.Parent;
  }

  return parent;
}

HostLayout.prototype.AddToGroup = function(node, group, groups) {
  var ID = node.ID;
  if (group in groups)
    groups[group][ID] = node;
  else
    groups[group] = {ID: node};
}

HostLayout.prototype.SetNodeGroups = function(n, node, groups) {
  if (n.Type() == "host")
    return;

  var parent = this.GetParentNode(n);
  if (typeof parent == "undefined" || parent == node)
    return;

  if (parent.Type() != "ovsport" && parent.Type() != "host")
    this.AddToGroup(node, parent.ID, groups);

  this.SetNodeGroups(parent, node, groups);
}

HostLayout.prototype.GetNodesGroups = function(n, node, groups) {
  var groups = {};

  for (var i in this.graph.Nodes) {
    var node = this.graph.Nodes[i];
    if (!(node.ID in this.elements))
      continue;

    var type = node.Type();

    // create an itself group
    if (type == "ovsbridge" || type == "netns")
      this.AddToGroup(node, node.ID, groups);

    this.SetNodeGroups(node, node, groups);
  }

  return groups;
}

HostLayout.prototype.GetConvexHulls = function() {
  var hulls = {};

  var groups = this.GetNodesGroups();
  for (var ID in groups) {
    var group = groups[ID];
    for (var n in group) {
      var node = group[n];

      if (isNaN(parseFloat(node.x)))
        continue;

      var l = hulls[ID] || (hulls[ID] = []);
      l.push([node.x - this.hullOffset, node.y - this.hullOffset]);
      l.push([node.x - this.hullOffset, node.y + this.hullOffset]);
      l.push([node.x + this.hullOffset, node.y - this.hullOffset]);
      l.push([node.x + this.hullOffset, node.y + this.hullOffset]);
    }
  }

  var hullset = [];
  for (var ID in hulls) {
    hullset.push({group: ID, path: d3.geom.hull(hulls[ID])});
  }

  return hullset;
}

HostLayout.prototype.DrawCluster = function(d) {
  var curve = d3.svg.line()
  .interpolate("cardinal-closed")
  .tension(.85);

  return curve(d.path);
}

HostLayout.prototype.GetNodeText = function(d) {
  name = this.graph.GetNode(d.ID).Name();
  if (name.length > 10)
    name = name.substr(0, 8) + ".";

  return name;
}

HostLayout.prototype.MouseOverNode = function(d) {
  this.NodeDetails(d);
}

HostLayout.prototype.MouseOutNode = function(d) {
}

HostLayout.prototype.Redraw = function() {
  var _this = this;

  this.link = this.link.data(this.links, function(d) {
    return d.source.ID + "-" + d.target.ID;
  });
  this.link.enter().insert("line", ".node")
  .style("opacity", function(d) {
    return _this.EdgeOpacity(d);
  })
  .attr("class", function(d) {
    return _this.LinkClass(d);
  });
  this.link.exit().remove();

  this.node = this.node.data(this.nodes, function(d) {
    return d.ID;
  });
  var nodeEnter = this.node.enter().append("g")
  .attr("class", "node")
  .call(this.force.drag);
  this.node.exit().remove();

  this.node.attr("class", function(d) {
    return _this.NodeClass(d);
  })

  nodeEnter.append("circle")
  .attr("r", this.CircleSize)
  .attr("class", "circle")
  .style("opacity", function(d) {
    return _this.CircleOpacity(d);
  })
  .on("mouseover", function(d) {
    _this.MouseOverNode(d);
  })
  .on("mouseout", function(d) {
    _this.MouseOutNode(d);
  });

  nodeEnter.append("image")
  .attr("xlink:href", function(d) {
    return _this.NodePicto(d);
  })
  .attr("x", -10)
  .attr("y", -10)
  .attr("width", 20)
  .attr("height", 20)
  .on("mouseover", function(d) {
    _this.MouseOverNode(d);
  })
  .on("mouseout", function(d) {
    _this.MouseOutNode(d);
  });

  nodeEnter.append("text")
  .attr("dx", 22)
  .attr("dy", ".35em")
  .text(function(d) {
    return _this.GetNodeText(d);
  });

  var hullsData = this.GetConvexHulls();

  this.hullG.selectAll("path.hull").remove();
  this.hull = this.hullG.selectAll("path.hull")
  .data(hullsData)
  .enter().append("path")
  .attr("class", "hull")
  .attr("id", function(d) {
    return d.group;
  })
  .attr("d", function(d) {
    return _this.DrawCluster(d);
  });

  this.node.select('text')
  .text(function(d){
      return _this.GetNodeText(d);
  })

  this.force.start();
}

var Layout = function(selector) {
  this.graph = new Graph();
  this.hosts = {};
  this.selector = selector;
  this.updatesocket = '';

  this.width = 680;
  this.height = 680;

  this.svg = d3.select(selector).append("svg")
  .attr("width", this.width)
  .attr("height", this.height)
  .attr("y", 60)
  .attr('viewBox', '0 0 ' + this.width + ' ' + this.height);
}

Layout.prototype.ReOrderLayout = function() {
  var x = 0;

  for (var host in this.hosts) {
    this.hosts[host].SetPosition(x, 0);
    x += this.hosts[host].GetBBox().width + 10;
  }

  this.width = x + 10;
  this.svg.attr("width", this.width);
  this.svg.attr("viewBox", '0 0 ' + this.width + ' ' + this.height);
}

Layout.prototype.AddHost = function(host) {
  this.hosts[host] = new HostLayout(host, this.graph, this.svg);

  this.ReOrderLayout();

  return this.hosts[host];
}

Layout.prototype.DelHost = function(node) {
  delete this.hosts[node.ID];
}

Layout.prototype.AddNode = function(node) {
  var hostLayout;
  if (!(node.Host in this.hosts))
    hostLayout = this.AddHost(node.Host);
  else
    hostLayout = this.hosts[node.Host];

  hostLayout.AddNode(node);
}

Layout.prototype.DelNode = function(node) {
  if (!(node.Host in this.hosts))
    return;

  this.hosts[node.Host].DelNode(node);
}

Layout.prototype.AddEdge = function(edge) {
  var hostLayout;
  if (!(edge.Host in this.hosts))
    hostLayout = this.AddHost(edge.Host);
  else
    hostLayout = this.hosts[edge.Host];

  hostLayout.AddEdge(edge);
}

Layout.prototype.DelEdge = function(edge) {
  if (!(edge.Host in this.hosts))
    return;

  this.hosts[edge.Host].DelEdge(edge);
}

Layout.prototype.InitFromSyncMessage = function(msg) {
  this.graph.InitFromSyncMessage(msg);

  for (var ID in this.graph.Nodes)
  this.AddNode(this.graph.Nodes[ID]);

  for (var ID in this.graph.Edges)
  this.AddEdge(this.graph.Edges[ID]);
}

Layout.prototype.Clear = function() {
  for (var ID in this.graph.Edges)
  this.DelEdge(this.graph.Edges[ID]);

  for (var ID in this.graph.Nodes)
  this.DelNode(this.graph.Nodes[ID]);

  for (var ID in this.graph.Edges)
  this.graph.DelEdge(this.graph.Edges[ID]);

  for (var ID in this.graph.Nodes)
  this.graph.DelNode(this.graph.Nodes[ID]);
}

Layout.prototype.Redraw = function() {
  for (var h in this.hosts) {
    this.hosts[h].Redraw();
  }
}

Layout.prototype.ProcessGraphMessage = function(msg) {
  switch(msg.Type) {
    case "SyncReply":
      this.Clear();
      this.InitFromSyncMessage(msg);
      break;

    case "NodeUpdated":
      var node = this.graph.GetNode(msg.Obj.ID);
      node.Metadata = msg.Obj.Metadata;

      this.Redraw();
      break;

    case "NodeAdded":
      var node = this.graph.NewNode(msg.Obj.ID, msg.Obj.Host);
      if ("Metadata" in msg.Obj)
        node.Metadata = msg.Obj.Metadata;

      this.AddNode(node);
      break;

    case "NodeDeleted":
      var node = this.graph.GetNode(msg.Obj.ID);
      if (typeof node == "undefined")
        return;

      this.graph.DelNode(node);
      this.DelNode(node);
      break;

    case "EdgeUpdated":
      var edge = this.graph.GetEdge(msg.Obj.ID);
      edge.Metadata = msg.Obj.Metadata;

      this.Redraw();
      break;

    case "EdgeAdded":
      var parent = this.graph.GetNode(msg.Obj.Parent);
      var child = this.graph.GetNode(msg.Obj.Child);

      var edge = this.graph.NewEdge(msg.Obj.ID, parent, child, msg.Obj.Host);
      if ("Metadata" in msg.Obj)
        edge.Metadata = msg.Obj.Metadata;

      this.AddEdge(edge);
      break;

    case "EdgeDeleted":
      var edge = this.graph.GetEdge(msg.Obj.ID);
      if (typeof edge == "undefined")
        break;

      this.graph.DelEdge(edge);
      this.DelEdge(edge);
      break;
  }
}

Layout.prototype.ProcessAlertMessage = function(msg) {
  var _this = this;

  var ID  = msg.ReasonData.ID;
  alerts[ID] = msg;
  this.Redraw();

  setTimeout(function() { delete alerts[ID]; _this.Redraw(); }, 1000);
}

Layout.prototype.StartLiveUpdate = function() {
  this.updatesocket = new WebSocket("ws://" + location.host + "/ws/graph");

  var _this = this;
  this.updatesocket.onopen = function() {
    var msg = {"Type": "SyncRequest"};
    _this.updatesocket.send(JSON.stringify(msg));
  }

  this.updatesocket.onclose = function() {
    setTimeout(function() { _this.StartLiveUpdate(); }, 1000);
  }

  this.updatesocket.onmessage = function(e) {
    var msg = jQuery.parseJSON(e.data);
    _this.ProcessGraphMessage(msg);
  };
}

Layout.prototype.StartLiveUpdateAlert = function() {
  this.updatesocketalert = new WebSocket("ws://" + location.host + "/ws/alert");

  var _this = this;
  this.updatesocketalert.onopen = function() {
  }

  this.updatesocketalert.onclose = function() {
    setTimeout(function() { _this.StartLiveUpdateAlert(); }, 3000);
  }

  this.updatesocketalert.onmessage = function(e) {
    var msg = jQuery.parseJSON(e.data);
    _this.ProcessAlertMessage(msg);
  };
}

var DiscoveryLayout = function(selector) {
  this.width = 680;
  this.height = 600;
  this.radius = (Math.min(this.width, this.height) / 2) - 50;
  this.color = d3.scale.category20c();

  this.svg = d3.select(selector).append("svg")
  .attr("width", this.width)
  .attr("height", this.height)
  .append("g")
  .attr("transform", "translate(" + this.width / 2 + "," + this.height * .52 + ")");

  this.partition = d3.layout.partition()
  .sort(null)
  .size([2 * Math.PI, this.radius * this.radius])
  .value(function(d) { return 1; });

  this.arc = d3.svg.arc()
  .startAngle(function(d) { return d.x; })
  .endAngle(function(d) { return d.x + d.dx; })
  .innerRadius(function(d) { return Math.sqrt(d.y); })
  .outerRadius(function(d) { return Math.sqrt(d.y + d.dy); });

  _this = this;
  d3.selectAll("#type").on("change", function() {
    _this.DrawChart(this.value);
  });
}

DiscoveryLayout.prototype.DrawChart = function(type) {
  this.svg.selectAll("*").remove();
  _this = this;
  //assign bytes as default if no type given.
  type = (type === undefined) ? "bytes" : type;
  d3.json("/rpc/discovery/" + type, function(root) {
    var path = _this.svg.datum(root).selectAll("path")
      .data(_this.partition.nodes)
      .enter().append("path")
      .attr("display", function(d) { return d.depth ? null : "none"; }) // hide inner ring
      .attr("d", _this.arc)
      .style("stroke", "#fff")
      .style("fill", function(d) { return _this.color((d.children ? d : d.parent).name); })
      .style("fill-rule", "evenodd")
      .each(stash);

    d3.selectAll("#mode").on("change", function change() {
      var value = this.value === "count"
        ? function() { return 1; }
        : function(d) { return d.size; };

      path
        .data(_this.partition.value(value).nodes)
        .transition()
        .duration(1500)
        .attrTween("d", arcTween);
    });
  });

  // Stash the old values for transition.
  function stash(d) {
    d.x0 = d.x;
    d.dx0 = d.dx;
  }

  // Interpolate the arcs in data space.
  function arcTween(a) {
    var i = d3.interpolate({x: a.x0, dx: a.dx0}, a);
    return function(t) {
      var b = i(t);
      a.x0 = b.x;
      a.dx0 = b.dx;
      return _this.arc(b);
    };
  }

  d3.select(self.frameElement).style("height", this.height + "px");
}

var ConversationLayout = function(selector) {
  this.width = 600;
  this.height = 600;

  var margin = {top: 100, right: 0, bottom: 10, left: 100};

  this.svg = d3.select(selector).append("svg")
  .attr("width", this.width + margin.left + margin.right)
  .attr("height", this.height + margin.top + margin.bottom)
  .style("margin-left", -margin.left + 20 + "px")
  .append("g")
  .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  this.orders = {};

  _this = this;
  d3.select("#layer").on("change", function() {
    _this.ShowConversation(this.value);
  });

  d3.select("#order").on("change", function() {
    _this.Order(this.value);
  });
}

ConversationLayout.prototype.Order = function(order) {
  if (!(order in this.orders))
    return

  var x = d3.scale.ordinal().rangeBands([0, _this.width]);

  x.domain(this.orders[order]);

  var t = this.svg.transition().duration(2500);

  t.selectAll(".row")
  .delay(function(d, i) { return x(i) * 4; })
  .attr("transform", function(d, i) {
    return "translate(0," + x(i) + ")";
  })
  .selectAll(".cell")
  .delay(function(d) { return x(d.x) * 4; })
  .attr("x", function(d) { return x(d.x); });

  t.selectAll(".column")
  .delay(function(d, i) { return x(i) * 4; })
  .attr("transform", function(d, i) {
    return "translate(" + x(i) + ")rotate(-90)";
  });
}

ConversationLayout.prototype.NodeDetails = function(node) {
  var json = JSON.stringify(node);
  $("#metadata_app").JSONView(json);
}

ConversationLayout.prototype.ShowConversation = function(layer) {
  this.svg.selectAll("*").remove();

  var _this = this;
  d3.json("/api/flow/conversation/" + layer, function(data) {
    var matrix = [];
    var nodes = data.nodes;
    var n = nodes.length;

    // Compute index per node.
    nodes.forEach(function(node, i) {
      node.index = i;
      node.count = 0;
      matrix[i] = d3.range(n).map(function(j) { return {x: j, y: i, z: 0}; });
    });

    // Convert links to matrix; count character occurrences.
    data.links.forEach(function(link) {
      matrix[link.source][link.target].z += link.value;
      matrix[link.target][link.source].z += link.value;
      matrix[link.source][link.source].z += link.value;
      matrix[link.target][link.target].z += link.value;
      nodes[link.source].count += link.value;
      nodes[link.target].count += link.value;
    });

    // Precompute the orders.
    _this.orders = {
      name: d3.range(n).sort(function(a, b) {
        return d3.ascending(nodes[a].name, nodes[b].name);
      }),
      count: d3.range(n).sort(function(a, b) {
        return nodes[b].count - nodes[a].count;
      }),
      group: d3.range(n).sort(function(a, b) {
        return nodes[b].group - nodes[a].group;
      })
    };

    var x = d3.scale.ordinal().rangeBands([0, _this.width]);
    var z = d3.scale.linear().domain([0, 4]).clamp(true);
    var c = d3.scale.category10().domain(d3.range(10));

    // The default sort order.
    x.domain(_this.orders.name);

    _this.svg.append("rect")
    .attr("class", "background")
    .attr("width", _this.width)
    .attr("height", _this.height);

    var row = _this.svg.selectAll(".row")
    .data(matrix)
    .enter().append("g")
    .attr("class", "row")
    .attr("transform", function(d, i) {
      return "translate(0," + x(i) + ")"; })
    .each(function(row) {
      var cell = d3.select(this).selectAll(".cell")
      .data(row.filter(function(d) { return d.z; }))
      .enter().append("rect")
      .attr("class", "cell")
      .attr("x", function(d) { return x(d.x); })
      .attr("width", x.rangeBand())
      .attr("height", x.rangeBand())
      .style("fill-opacity", function(d) { return z(d.z); })
      .style("fill", function(d) { return nodes[d.x].group == nodes[d.y].group ? c(nodes[d.x].group) : null; })
      .on("mouseover", function(p) {
        d3.selectAll(".row text").classed("active", function(d, i) { return i == p.y; });
        d3.selectAll(".column text").classed("active", function(d, i) { return i == p.x; });
        _this.NodeDetails(nodes[p.x]);
      })
      .on("mouseout", function(p) {
        d3.selectAll("text").classed("active", false);
      });
    });

    row.append("line")
      .attr("x2", _this.width);

    row.append("text")
    .attr("x", -6)
    .attr("y", x.rangeBand() / 2)
    .attr("dy", ".32em")
    .attr("text-anchor", "end")
    .text(function(d, i) { return nodes[i].name; });

    var column = _this.svg.selectAll(".column")
    .data(matrix)
    .enter().append("g")
    .attr("class", "column")
    .attr("transform", function(d, i) {
      return "translate(" + x(i) + ")rotate(-90)";
    });

    column.append("line")
    .attr("x1", -_this.width);

    column.append("text")
    .attr("x", 6)
    .attr("y", x.rangeBand() / 2)
    .attr("dy", ".32em")
    .attr("text-anchor", "start")
    .text(function(d, i) { return nodes[i].name; });
  });
}

var topologyLayout;
var conversationLayout;
var discoveryLayout;

$(document).ready(function() {
  if ("{{.Service}}" == "agent") {
    $("#flows-panel").hide();
    $("#conversation").hide();
    $("#discovery").hide();
  }
  else {
    $('#topology-btn').click(function() {
      $('#topology').addClass('active');
      $('#conversation').removeClass('active');
      $('#discovery').removeClass('active');

      $('.topology').show();
      $('.conversation').hide();
      $('.discovery').hide();
    });

    $(".title-capture-switch").hide()

    $('#conversation-btn').click(function() {
      $('#topology').removeClass('active');
      $('#conversation').addClass('active');
      $('#discovery').removeClass('active');

      $('.topology').hide();
      $('.conversation').show();
      $('.discovery').hide();

      conversationLayout.ShowConversation("ethernet");
    });
    $('#discovery-btn').click(function() {
      $('#topology').removeClass('active');
      $('#conversation').removeClass('active');
      $('#discovery').addClass('active');

      $('.topology').hide();
      $('.conversation').hide();
      $('.discovery').show();

      discoveryLayout.DrawChart();
    });
  }

  $('.content').resizable({
    handles: 'e',
    minWidth: 300,
    resize:function(event,ui){
      var x=ui.element.outerWidth();
      var y=ui.element.outerHeight();
      var ele=ui.element;
      var factor = $(this).parent().width()-x;
      var f2 = $(this).parent().width() * .02999;
      $.each(ele.siblings(),function(idx,item) {
        ele.siblings().eq(idx).css('height',y+'px');
        ele.siblings().eq(idx).width((factor-f2)+'px');
      });
    }
  });

  topologyLayout = new Layout(".topology-d3");
  topologyLayout.StartLiveUpdate();
  topologyLayout.StartLiveUpdateAlert();

  conversationLayout = new ConversationLayout(".conversation-d3")
  discoveryLayout = new DiscoveryLayout(".discovery-d3");
});